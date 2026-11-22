import type { GameEvent } from '../../runtime/game-event-bus.ts';
import { HAND_ZONE } from '../mingpai/mingpai-engine.ts';

type Movement = Extract<GameEvent, { type: 'cards-moved' }>;
type Location = { zone: number; owner: number; param: number };

const DISCARD_ZONE = 2;
const DRAW_PILE_ZONE = 1;
const STACK_ZONE = 3;
const EQUIPMENT_ZONE = 6;
const JUDGMENT_ZONE = 7;
const SPELL_ZONE = 8;
const SHUFFLE_ZONE = 9;
const TEMP_ZONE = 10;
const PUBLIC_ZONES = new Set([DISCARD_ZONE, EQUIPMENT_ZONE, JUDGMENT_ZONE]);
const SHOW = 6;
const FIRE_ATTACK_SPELL = 83;
const HARVEST_SPELL = 6;
const JIEYAN = 3638;
const JIEWU = 3659;
const PUBLIC_HAND_REVEAL_SKILLS = new Set([FIRE_ATTACK_SPELL, JIEYAN, JIEWU]);
export const CARD_MOVE_ONLY_SHOW = 21;
// 正常用牌、打出、判定并弃置会在处理区公开牌面。
const PUBLIC_STACK_MOVES = new Set([2, 3, 14]);

export function isPublicInPlaceHandReveal(move: Movement): boolean {
  if (move.fromZone !== HAND_ZONE || move.toZone !== HAND_ZONE || move.fromId !== move.toId) return false;
  // 捷悟公开选中的一张牌时留在原位置；持续私有看牌另用 OPT_JIEWU_SEAT_CARDS。
  return move.moveType === SHOW || move.showsCardFaces === true
    || ((move.moveType === CARD_MOVE_ONLY_SHOW || move.moveType === 0) && PUBLIC_HAND_REVEAL_SKILLS.has(move.spellId));
}

export function publicHandRevealLabel(spellId: number): string {
  if (spellId === JIEYAN) return '[节言]';
  if (spellId === JIEWU) return '[捷悟]';
  return '[明牌]';
}

/** 记录已公开且仍能沿移牌连续辨认的牌。只使用游戏在这条消息里给出的牌号。 */
export function createPublicCardOrigins() {
  const locations = new Map<number, Location>();

  function observe(move: Movement, resolvedCardIds: readonly number[]): ReadonlySet<number> {
    const rawIds = new Set(move.cardIds.filter((id) => id > 0));
    const publicIds = new Set<number>();
    const fromMatches = (location: Location) => location.zone === move.fromZone && location.owner === move.fromId
      && (location.zone !== SPELL_ZONE && location.zone !== TEMP_ZONE || location.param === move.fromZoneParam);
    const destination = { zone: move.toZone, owner: move.toId, param: move.toZoneParam };
    const inPlace = move.fromZone === move.toZone && move.fromId === move.toId;

    // 五谷把候选牌送进技能区给全场挑选。其他技能的同一区也可能只用于私有看牌。
    const harvestDisplay = move.spellId === HARVEST_SPELL && move.toZone === SPELL_ZONE;
    const jieyanDraw = move.spellId === JIEYAN && move.fromZone === DRAW_PILE_ZONE && move.toZone === HAND_ZONE;
    const onlyShowing = move.moveType === CARD_MOVE_ONLY_SHOW;
    const publicInPlaceShow = inPlace && (move.fromZone === STACK_ZONE || PUBLIC_ZONES.has(move.fromZone));
    const explicitlyShown = move.showsCardFaces === true || move.moveType === SHOW || harvestDisplay || jieyanDraw
      || isPublicInPlaceHandReveal(move)
      || (onlyShowing && publicInPlaceShow);
    if (onlyShowing && !inPlace && !explicitlyShown) return publicIds;

    for (const id of rawIds) {
      const location = locations.get(id);
      // 从牌堆摸到时，只有这次移牌公开牌面才算明牌。旧亮牌记录和本家私有牌号都不能作为证据。
      const stillPublic = move.fromZone !== DRAW_PILE_ZONE
        && (PUBLIC_ZONES.has(move.fromZone) || (location && fromMatches(location)));
      if (explicitlyShown || stillPublic) publicIds.add(id);
    }

    if (inPlace && (move.moveType === SHOW || onlyShowing || move.moveType === 0)) {
      if (move.toZone !== DRAW_PILE_ZONE) {
        for (const id of publicIds) locations.set(id, destination);
      }
      return publicIds;
    }

    for (const id of resolvedCardIds) if (id > 0) locations.delete(id);
    // 有暗牌离开时，无法确定原区哪张已亮的牌还在这里。
    if (rawIds.size < move.cardCount || move.toZone === SHUFFLE_ZONE) {
      for (const [id, location] of locations) if (fromMatches(location)) locations.delete(id);
    }
    if (move.toZone === SHUFFLE_ZONE || move.fromZone === SHUFFLE_ZONE || move.toZone === 12) return publicIds;

    const goesPublic = PUBLIC_ZONES.has(move.toZone)
      || (move.toZone === STACK_ZONE && PUBLIC_STACK_MOVES.has(move.moveType));
    for (const id of rawIds) {
      locations.delete(id);
      if (move.toZone !== DRAW_PILE_ZONE && (goesPublic || publicIds.has(id))) {
        locations.set(id, destination);
      }
    }
    return publicIds;
  }

  return { observe, clear: () => locations.clear() };
}
