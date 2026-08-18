// **局面を宣言で持つ。**
//
// ボスの動きは `mode` / `stage` / `act` / `timer` / `hide` がばらばらに置かれていて、
// **どの組み合わせが何の局面か**が当たり判定の側にも写っていた。
// (突進中の判定が `rage && hide<=0 && telegraph<=0`。「顔を出すときも
//  大ダメージが残っていないか」を確かめるのに 3 か所を読む必要があった)
//
// **状態の名前が 1 か所にしかない**のが肝。当たり判定は `fsm.is('charge')` だけを見る。
//
// ```js
// const CRAB = {
//   enter:  { update: (b) => { b.y += 1; }, when: (b) => b.y >= TOP, next: 'attach' },
//   wait:   { enter: (b) => { ... }, for: 120, next: 'enter' },
//   attach: { update: (b) => { ... }, to: (b) => b.needJump ? 'jump' : null },
//   peek:   { for: 200, cues: { 150: 'count3', 100: 'count2' }, next: 'charge' },
//   float:  {},   // 行き止まり(ここで終わる局面)
// };
// const fsm = new StateMachine(CRAB, { start: 'enter', on: (name) => playSE(name) });
// ```
//
// **書いたものはそのまま試験になる。** `check()` が行き先の綴り間違い・
// 誰も来ない局面・出口の無い局面を見つける。図は `toMermaid()` が吐くので、
// 仕様書のほうが古くなることがない。

/**
 * 局面ひとつの書きかた。**どれも省いてよい。**
 *
 * - `enter(ctx, fsm)` … 入った瞬間に 1 回
 * - `update(ctx, fsm)` … いるあいだ毎コマ
 * - `exit(ctx, fsm)` … 出る瞬間に 1 回
 * - `for` … このコマ数が過ぎたら `next` へ。**毎回ちがうなら関数**で書く
 *   (`for: (b) => 260 + rnd(180)`。入った瞬間に 1 回だけ呼ばれる)
 * - `when(ctx, fsm)` … 真を返したら `next` へ
 * - `next` … 行き先の名前
 * - `to(ctx, fsm)` … 行き先を自分で決める(名前を返す。まだなら偽)
 * - `goes` … `to` が選びうる行き先を並べる。**`to` を書いたら必ず添える**
 *   (中身は読めないので、宣言に書いてもらわないと図にも試験にも出てこない)
 * - `cues` … `{ 残りコマ数: 合図の名前 }`。`on` へ渡る
 * - `viaGo` … `go()` でしか来ない局面だと書き添える(`check()` が見逃す)
 *
 * **行き先を決める順番は for → when → to。**先に決まったものが勝つ。
 */
export class StateMachine {
  /**
   * @param {object} defs 局面の宣言。`{ 名前: 書きかた }`
   * @param {object} [opts]
   * @param {string} [opts.start] 始まりの局面(省くと宣言の 1 つめ)
   * @param {(cue: string, ctx: any) => void} [opts.on] 合図(cues)の受け取り
   * @param {(from: string, to: string, ctx: any) => void} [opts.onChange] 移ったとき
   */
  constructor(defs, opts = {}) {
    this.defs = defs;
    this.names = Object.keys(defs);
    if (!this.names.length) throw new Error('StateMachine: 局面がひとつも無い');
    this.on = opts.on || null;
    this.onChange = opts.onChange || null;
    /** いまの局面の名前 */
    this.state = opts.start || this.names[0];
    if (!defs[this.state]) throw new Error('StateMachine: 始まりの局面が無い: ' + this.state);
    /** いまの局面に入ってからのコマ数 */
    this.age = 0;
    /** `for` の残り(`for` が無ければ -1) */
    this.timer = StateMachine._span(this.defs[this.state], undefined);
    /** 通ってきた道(直前の 8 つ)。開発用 */
    this.trail = [this.state];
    this._entered = false;
  }

  /** `for` を読む。関数なら入った瞬間に 1 回だけ呼ぶ */
  static _span(d, ctx) {
    if (d.for === undefined) return -1;
    return typeof d.for === 'function' ? d.for(ctx) : d.for;
  }

  /** いまその局面か */
  is(name) { return this.state === name; }

  /** いまその中のどれかか。「硬い局面」をまとめて書ける */
  in(...names) { return names.includes(this.state); }

  /** いまの局面の宣言 */
  get def() { return this.defs[this.state]; }

  /**
   * 好きな局面へ飛ばす。**`exit` と `enter` はきちんと通る**ので、
   * 途中で割り込んでも後始末が飛ばされない
   * (甲羅が割れた・撃破された、など「どこからでも起きること」に使う)
   */
  go(name, ctx) {
    const to = this.defs[name];
    if (!to) throw new Error('StateMachine: 知らない局面へ飛ばそうとした: ' + name);
    const from = this.state;
    if (this._entered && this.defs[from].exit) this.defs[from].exit(ctx, this);
    this.state = name;
    this.age = 0;
    this.timer = StateMachine._span(to, ctx);
    this._entered = false;
    this.trail.push(name);
    if (this.trail.length > 8) this.trail.shift();
    if (this.onChange) this.onChange(from, name, ctx);
    return name;
  }

  /**
   * 1 コマ進める。
   *
   * **移ったコマは、移った先を走らせない。** 行き先が決まるのはコマの終わりで、
   * `enter` と `update` は次のコマからそろって走る。こうしないと、
   * 1 コマのうちに 2 つの局面が動いてしまい、**何コマ目に何が起きたか**が
   * 追えなくなる(そのまま回帰試験の当てにならなくなる)。
   * @returns {string} 進めたあとの局面の名前
   */
  step(ctx) {
    const d = this.def;
    if (!this._entered) {
      this._entered = true;
      if (d.enter) d.enter(ctx, this);
      // `enter` の中で飛んだなら、そちらを先に立てる
      if (this.def !== d) return this.state;
    }
    if (d.update) d.update(ctx, this);
    if (this.def !== d) return this.state;   // `update` の中で飛んだ

    this.age++;
    if (this.timer >= 0) {
      this.timer--;
      // 合図は「残り」で書く。近づいてくる数字のほうが読みやすい
      if (d.cues && this.on) {
        const cue = d.cues[this.timer];
        if (cue) this.on(cue, ctx);
      }
    }

    // 行き先を決める。for -> when -> to の順で、先に決まったものが勝つ
    let to = null;
    if (this.timer === 0 && d.next) to = d.next;
    if (!to && d.when && d.when(ctx, this)) to = d.next;
    if (!to && d.to) to = d.to(ctx, this) || null;
    if (to) this.go(to, ctx);
    return this.state;
  }

  /**
   * **宣言の粗さがしをする。**試験から呼ぶ。
   * @returns {string[]} 見つかった問題。空なら健全
   */
  check() {
    const bad = [];
    const known = new Set(this.names);
    // 行き先が実在するか(綴り間違い・消し忘れ)
    const reached = new Set([this.names[0]]);
    for (const [name, d] of Object.entries(this.defs)) {
      if (d.next !== undefined) {
        if (typeof d.next !== 'string') bad.push(name + ': next は名前で書く');
        else if (!known.has(d.next)) bad.push(name + ': 行き先が無い -> ' + d.next);
        else reached.add(d.next);
      }
      if ((d.for !== undefined || d.when) && !d.next && !d.to) {
        bad.push(name + ': for/when があるのに行き先(next か to)が無い');
      }
      if (d.next && d.for === undefined && !d.when) bad.push(name + ': next があるのに for も when も無い(いつ移るのか決まらない)');
      if (d.cues && d.for === undefined) bad.push(name + ': cues は for のある局面にしか書けない');
      // `to` の中身は読めないので、行き先は `goes` に書いてもらう
      if (d.to && !d.goes) bad.push(name + ': to があるのに goes が無い(選びうる行き先を並べる)');
      if (d.goes && !d.to) bad.push(name + ': goes があるのに to が無い');
      for (const n of d.goes || []) {
        if (!known.has(n)) bad.push(name + ': goes の行き先が無い -> ' + n);
        else reached.add(n);
      }
    }
    // 誰も来ない局面。消し忘れか、`go()` でしか来ないもの。
    // **後者は `viaGo: true` と書き添える。**書いてあれば見逃す
    for (const name of this.names) {
      if (!reached.has(name) && !this.defs[name].viaGo) {
        bad.push(name + ': ここへ来る道が宣言に無い(go() でだけ来るなら viaGo: true と書く)');
      }
    }
    return bad;
  }

  /**
   * 図を吐く。**仕様書のほうが古くなることがない**のが狙い。
   * `to` で選ぶ行き先(`goes`)は点線にして、決まった移りと見分けられるようにする
   */
  toMermaid(title = '') {
    const L = ['stateDiagram-v2'];
    if (title) L.push('  %% ' + title);
    L.push('  [*] --> ' + this.names[0]);
    for (const [name, d] of Object.entries(this.defs)) {
      if (d.next) {
        const why = d.for !== undefined
          ? (typeof d.for === 'function' ? '決めたコマ数' : d.for + ' コマ')
          : (d.when ? '条件' : '');
        L.push('  ' + name + ' --> ' + d.next + (why ? ' : ' + why : ''));
      }
      for (const n of d.goes || []) {
        if (this.defs[n] && n !== name) L.push('  ' + name + ' -.-> ' + n);
      }
      if (d.cues) {
        for (const [t, cue] of Object.entries(d.cues)) L.push('  note right of ' + name + ': 残り ' + t + ' で ' + cue);
      }
    }
    return L.join('\n');
  }
}
