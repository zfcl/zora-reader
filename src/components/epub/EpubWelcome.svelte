<script lang="ts">
  interface Props {
    visible: boolean;
    onConfirm: () => void | Promise<void>;
  }

  let { visible, onConfirm }: Props = $props();
</script>

{#if visible}
  <div class="zora-welcome-backdrop" role="presentation">
    <div class="zora-welcome-card" role="dialog" aria-modal="true" aria-labelledby="zora-welcome-title">
      <h2 id="zora-welcome-title">欢迎使用 Zora Reader</h2>
      <p>选中文本即可使用翻译、理解、语法和笔记；手机端还可以拖动选词。</p>
      <button type="button" onclick={onConfirm}>知道了</button>
    </div>
  </div>
{/if}

<style>
  .zora-welcome-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    padding: 24px;
    background: color-mix(in srgb, var(--background-modifier-cover) 50%, transparent);
  }

  .zora-welcome-card {
    width: min(360px, calc(100vw - 48px));
    padding: 22px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 14px;
    background: var(--background-primary);
    box-shadow: var(--shadow-l);
    text-align: center;
  }

  h2 {
    margin: 0 0 10px;
    font-size: 1.25rem;
  }

  p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.6;
  }

  button {
    margin-top: 18px;
    min-width: 112px;
    min-height: 38px;
    border-radius: 8px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-weight: 600;
  }
</style>
