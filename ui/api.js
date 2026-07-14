// Thin fetch wrappers. Every mutation answers with fresh SSE state anyway,
// so callers mostly fire-and-forget; errors surface as a toast.

export async function post(path, body) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    return data;
  } catch (e) {
    toast(String(e.message ?? e));
    throw e;
  }
}

export const op = (body) => post("/api/op", body);
export const request = (type, target, params, pngBase64) =>
  post("/api/request", { type, target, params, pngBase64 });

let toastTimer = null;
export function toast(text, action) {
  document.getElementById("toast")?.remove();
  const el = document.createElement("div");
  el.id = "toast";
  const span = document.createElement("span");
  span.textContent = text;
  el.appendChild(span);
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.run(); };
    el.appendChild(b);
  }
  const x = document.createElement("button");
  x.className = "x";
  x.textContent = "✕";
  x.onclick = () => el.remove();
  el.appendChild(x);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 6000);
}
