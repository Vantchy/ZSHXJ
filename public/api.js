/* 唯一前后端网络层；章节插件不可直接请求后端。 */
const KEY = "huaxia_v2_token";
let token = localStorage.getItem(KEY) || localStorage.getItem("huaxia_architecture_token") || "";

export function hasToken() { return Boolean(token); }
export function setToken(value) {
  token = value;
  localStorage.setItem(KEY, value);
  localStorage.removeItem("huaxia_architecture_token");
}
export function clearToken() {
  token = "";
  localStorage.removeItem(KEY);
  localStorage.removeItem("huaxia_architecture_token");
}

export class ApiError extends Error {
  constructor(status, message, code, body) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...options, headers });
}

export async function api(method, path, body) {
  const options = { method };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers = { "Content-Type": "application/json" };
  }
  const reply = await request(path, options);
  const result = await reply.json().catch(() => ({}));
  if (!reply.ok) {
    throw new ApiError(reply.status, result.error || "请求失败", result.code, result);
  }
  return result;
}

export async function downloadCsv(path) {
  const reply = await request(path);
  if (!reply.ok) {
    const result = await reply.json().catch(() => ({}));
    throw new ApiError(reply.status, result.error || "导出失败", result.code, result);
  }
  const blob = await reply.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = path.split("?")[0].endsWith("/students.csv") ? "students.csv" : "scores.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

export async function asBase64(file) {
  if (file.size > 2 * 1024 * 1024 || file.size === 0) {
    throw new Error("文件必须在1字节至2MB之间");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}
