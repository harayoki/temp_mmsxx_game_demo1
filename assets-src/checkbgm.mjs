// 各 BGM のトラック長がそろっているか確認する(開発用)
import { compileMML } from '../vendor/mmsxx-mml-studio/sound/mml.js';
import { GAME_DATA } from '../game/gamedata.js';

let ng = 0;
for (const [name, tracks] of Object.entries(GAME_DATA.bgm)) {
  const list = Array.isArray(tracks) ? tracks : [tracks];
  const totals = list.map(t => compileMML(t.trim()).total.toFixed(3));
  const uniq = [...new Set(totals)];
  const mark = uniq.length === 1 ? 'OK ' : 'NG ';
  if (uniq.length !== 1) ng++;
  console.log(mark + name + ': ' + totals.join(' / '));
}
for (const [name, tracks] of Object.entries(GAME_DATA.se)) {
  const list = Array.isArray(tracks) ? tracks : [tracks];
  const totals = list.map(t => compileMML(t.trim()).total.toFixed(3));
  console.log('SE ' + name + ': ' + totals.join(' / '));
}
console.log(ng ? ng + ' 曲でトラック長が不一致' : 'すべてのトラック長がそろっています');
