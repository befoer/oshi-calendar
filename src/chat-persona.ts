/** 聊天里「我是谁」：称呼和简介（全局，只存在本机浏览器），会作为资料告诉扮演角色的 AI。 */
export type Persona = { name: string; about: string };
const KEY = "huiqi-chat-persona";
export function loadPersona(): Persona {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      name: typeof raw.name === "string" ? raw.name : "",
      about: typeof raw.about === "string" ? raw.about : "",
    };
  } catch {
    return { name: "", about: "" };
  }
}
export function savePersona(persona: Persona) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ name: persona.name.trim(), about: persona.about.trim() }),
    );
  } catch {
    /* 存不下就算了 */
  }
}
