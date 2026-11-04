export const $ = (sel, root = document) => root.querySelector(sel)

export function make(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}
