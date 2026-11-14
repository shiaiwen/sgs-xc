/**
 * 读请求正文里的 JSON 对象。小抄按纯文本发 JSON，浏览器不用先发一次跨域询问，这里不看内容类型。
 * 不是对象时返回 null。
 */
export async function readJsonBody(context) {
  try {
    const body = JSON.parse(await context.req.text());
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
