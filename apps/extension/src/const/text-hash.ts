/** 32 位 FNV-1a 字符串摘要的起始值。 */
export const FNV1A_OFFSET_BASIS = 0x811c9dc5;

/** 32 位 FNV-1a 字符串摘要每读一个字符乘的数。 */
export const FNV1A_PRIME = 0x01000193;

/** 摘要按这个进制写成字符串。 */
export const HASH_TEXT_RADIX = 36;

/** sha256 校验值按十六进制写成字符串。 */
export const HEX_RADIX = 16;

/** 十六进制下一个字节写成几位。 */
export const HEX_DIGITS_PER_BYTE = 2;
