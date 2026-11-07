/* 局域网非安全上下文也可用的演示随机数工具；不用于账号凭证。 */
export function randomInt(min, max) {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return min + (values[0] % (max - min + 1));
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function clientUUID() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
// clientUUID是非认证用途的备用ID；成绩attemptId始终由后端签发。
