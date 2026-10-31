import { newCharacter, newPreset, type Character } from "../domain";

// Synthetic records for tests only. Never import this module from application code.
export const testCharacters = (): Character[] =>
  [
    46465, 183099, 35616, 132477, 198022, 10439, 87968, 22520, 86143, 72355,
    10700, 19527, 19528, 23425, 51006, 23648, 32,
  ].map((id, i) => {
    const c = newCharacter(`测试角色 ${i + 1}`, `test_character_${i + 1}`);
    c.id = `fixture-${i + 1}`;
    c.bangumiId = id;
    if (i === 0) c.presets[0].positive = "test_character, (blue_hair:0.8)";
    if (i === 2) {
      c.name = "碧翠丝";
      c.works = ["Re:从零开始的异世界生活"];
      c.presets[0].positive = "test_character \\(test_series\\)";
    }
    if (i === 5) c.presets.push(newPreset("test_alternate_form", "测试形态"));
    return c;
  });
