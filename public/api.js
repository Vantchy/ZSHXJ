/* 唯一前后端网络层；章节插件不可直接请求后端。 */
const KEY = "huaxia_v2_token";
let token = localStorage.getItem(KEY) || localStorage.getItem("huaxia_architecture_token") || "";
// Increment on every login/logout, including switching back to the same account.
let tokenGeneration = 0;
export function getAuthSnapshot() {
  return Object.freeze({token, generation:tokenGeneration});
}
export function isAuthSnapshotCurrent(snapshot) {
  return Boolean(snapshot && snapshot.token === token &&
    snapshot.generation === tokenGeneration);
}

export function hasToken() { return Boolean(token); }
export function setToken(value) {
  tokenGeneration++;
  token = value;
  localStorage.setItem(KEY, value);
  localStorage.removeItem("huaxia_architecture_token");
}
export function clearToken() {
  tokenGeneration++;
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
  // authToken is an internal, explicit snapshot for delayed operations.
  // Never pass it through as a custom Fetch option or change global auth.
  const {authToken, ...fetchOptions} = options;
  const requestToken = Object.prototype.hasOwnProperty.call(options, 'authToken')
    ? authToken : token;
  const headers = new Headers(fetchOptions.headers || {});
  if (requestToken) headers.set("Authorization", `Bearer ${requestToken}`);
  return fetch(path, { ...fetchOptions, headers });
}

export async function api(method, path, body, requestOptions = {}) {
  const startedGeneration = tokenGeneration;
  const options = {...requestOptions, method};
  if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers = {...(requestOptions.headers || {}), "Content-Type": "application/json"};
  }
  const reply = await request(path, options);
  const result = await reply.json().catch(() => ({}));
  // Even a failed old-account request must not display an auth error or
  // accidentally clear a newer login when its HTTP response arrives late.
  if (startedGeneration !== tokenGeneration) {
    throw new ApiError(0, '账号会话已切换，旧请求已取消', 'SESSION_CHANGED');
  }
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
