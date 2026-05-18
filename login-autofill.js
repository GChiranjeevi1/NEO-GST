"use strict";

const browser = globalThis.browser || globalThis.chrome;

const normalize = (val) => (val || "").toLowerCase();
const isVisible = (el) => !!(el && el.offsetParent);

const findInput = (predicate) => {
  const inputs = Array.from(document.querySelectorAll("input"));
  return inputs.find((el) => predicate(el));
};

const inputByHint = (hints, type) =>
  findInput((el) => {
    if (type && el.type && normalize(el.type) !== type) return false;
    const id = normalize(el.id);
    const name = normalize(el.name);
    const placeholder = normalize(el.placeholder);
    const aria = normalize(el.getAttribute("aria-label"));
    return hints.some((h) => id.includes(h) || name.includes(h) || placeholder.includes(h) || aria.includes(h));
  });

const setNativeValue = (el, value) => {
  const { set } = Object.getOwnPropertyDescriptor(el.__proto__, "value") || {};
  if (set) {
    set.call(el, value);
  } else {
    el.value = value;
  }
};

const fillInput = (el, value) => {
  if (!el || !value) return;
  if (!isVisible(el)) return;
  el.focus();
  setNativeValue(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

const focusCaptcha = () => {
  const captcha = inputByHint(["captcha", "security", "verify", "image"], null);
  if (captcha) {
    captcha.focus();
    return true;
  }
  return false;
};

const tryFill = (payload) => {
  if (!payload) return;
  const username =
    payload.username ||
    payload.user ||
    payload.userId ||
    payload.gstin ||
    "";
  const password = payload.password || "";

  const userInput =
    inputByHint(["username", "userid", "user", "gstin", "login"], "text") ||
    inputByHint(["username", "userid", "user", "gstin", "login"], null) ||
    findInput(
      (el) =>
        isVisible(el) &&
        (!el.type || el.type === "text" || el.type === "email" || el.type === "tel"),
    );
  const passInput =
    document.getElementById("user_pass") ||
    inputByHint(["password", "passwd", "pass"], "password") ||
    inputByHint(["password", "passwd", "pass"], null) ||
    findInput(
      (el) =>
        isVisible(el) &&
        (el.type === "password" ||
          normalize(el.autocomplete) === "current-password" ||
          normalize(el.autocomplete) === "password"),
    ) ||
    findInput((el) => isVisible(el) && /pass/i.test(el.name || el.id || el.placeholder || ""));

  fillInput(userInput, username);
  fillInput(passInput, password);
  focusCaptcha();
};

const runWithRetries = (payload) => {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    tryFill(payload);
    if (attempts >= 10 || focusCaptcha()) {
      clearInterval(timer);
    }
  }, 500);
};

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "gst-autofill-login") return;
  runWithRetries(msg.payload || {});
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", focusCaptcha);
} else {
  focusCaptcha();
}
