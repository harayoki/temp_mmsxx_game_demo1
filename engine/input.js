// キーボード入力。KeyboardEvent.code (例: 'ArrowLeft', 'Space', 'KeyZ') で参照する。
export class Input {
  /** @param {() => void} [onFirstInput] 最初のキー入力時に呼ばれる(オーディオ解禁用) */
  constructor(onFirstInput) {
    /** @type {Set<string>} 押下中 */
    this.down = new Set();
    /** @type {Set<string>} このフレームで押された */
    this.pressed = new Set();
    this.onFirstInput = onFirstInput;

    window.addEventListener('keydown', (e) => {
      if (this.onFirstInput) { this.onFirstInput(); }
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      // ゲーム用キーのスクロールなどを抑止
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  /** キーが押されているか */
  isDown(code) { return this.down.has(code); }

  /** このフレームで押されたか(押しっぱなしでは false) */
  wasPressed(code) { return this.pressed.has(code); }

  /** フレーム終わりにエンジンが呼ぶ */
  endFrame() { this.pressed.clear(); }
}
