import { newCharacter, newPreset, type Character } from "./domain";
const entries = [
  [
    "洛琪希",
    "Roxy migurdia, ( jitome:0.8),  frills, dress, white dress, ahoge, bare shoulders",
    "无职转生",
  ],
  ["伊莉雅", "prisma illya", "魔法少女☆伊莉雅"],
  ["碧翠丝", "beatrice \\(re:zero\\)", "Re:从零开始的异世界生活"],
  ["若叶睦", "wakaba mutsumi", "BanG Dream! Ave Mujica"],
  ["露露卡", "moria luluka, cure arcana shadow", "光之美少女"],
  ["鹿目圆", "kaname madoka", "魔法少女小圆"],
  ["波奇酱", "gotoh hitori", "孤独摇滚！"],
  ["和泉纱雾", "izumi sagiri", "埃罗芒阿老师"],
  ["虚饰魔女（潘多拉）", "pandora \\(re:zero\\)", "Re:从零开始的异世界生活"],
  ["灰之魔女（伊蕾娜）", "elaina \\(majo no tabitabi\\)", "魔女之旅"],
  ["五更琉璃", "gokou ruri", "我的妹妹哪有这么可爱！"],
  ["五河琴里", "itsuka kotori", "约会大作战"],
  ["四糸乃", "himekawa yoshino", "约会大作战"],
  ["白", "shiro \\(no game no life\\)", "游戏人生"],
  [
    "珂朵莉",
    "Chtholly Nota Seniorious",
    "末日时在做什么？有没有空？可以来拯救吗？",
  ],
  ["香风智乃", "Kafu Chino", "请问您今天要来点兔子吗？"],
  ["小叽", "chii \\(chobits\\)", "人形电脑天使心"],
];
export const seedBangumiIds = [
  46465, 183099, 35616, 132477, 198022, 10439, 87968, 22520, 86143, 72355,
  10700, 19527, 19528, 23425, 51006, 23648, 32,
];
export const seedName = (id: string) =>
  entries[Number(id.replace("seed-", "")) - 1]?.[0];
// Verified character identities; birthdays are fetched independently at startup.
const portraits = [
  "fe/d5/46465_crt_EByBv.jpg",
  "e0/79/183099_crt_WvU45.jpg",
  "48/15/35616_crt_b0mMv.jpg",
  "24/fc/132477_crt_0CX1J.jpg",
  "ae/3b/198022_crt_8Sz8a.jpg",
  "2f/95/10439_crt_gwR7m.jpg",
  "b1/9c/87968_crt_z9LaF.jpg",
  "3d/ec/22520_crt_Jz19b.jpg",
  "1a/09/86143_crt_5pZ26.jpg",
  "35/0e/72355_crt_6Z6zM.jpg",
  "ff/1c/10700_crt_cyfVo.jpg",
  "a1/6e/19527_crt_88IeP.jpg",
  "5a/ca/19528_crt_clh1A.jpg",
  "2e/28/23425_crt_J8wDz.jpg",
  "4f/db/51006_crt_jjz0y.jpg",
  "d4/54/23648_crt_cIzBF.jpg",
  "ce/65/32_crt_0g9f9.jpg",
];
export const seedCharacters = (): Character[] =>
  entries.map(([name, tag, work], i) => {
    const c = newCharacter(name, tag);
    c.id = `seed-${i + 1}`;
    c.bangumiId = seedBangumiIds[i];
    c.works = [work];
    if (name === "鹿目圆") {
      c.aliases = ["终极圆神"];
      c.presets.push(newPreset("ultimate madoka", "终极圆神"));
    }
    if (name === "四糸乃") c.notes = "noob无";
    c.avatarUrl = "https://lain.bgm.tv/r/400/pic/crt/l/" + portraits[i];
    return c;
  });
