<script lang="ts">
  const DISCLAIMER_KEY = 'wr-disclaimer-v1';

  let visible = $state(!localStorage.getItem(DISCLAIMER_KEY));

  function accept() {
    localStorage.setItem(DISCLAIMER_KEY, '1');
    visible = false;
  }
</script>

{#if visible}
<div class="disclaimer-overlay" role="dialog" aria-modal="true">
  <div class="disclaimer-box">
    <h2>Safety disclaimer</h2>
    <p>This is an experimental plugin. Calculated routes have not been validated by sailing them and <strong>may cross land or shallow water</strong>.</p>
    <p>Weather forecasts change. The route calculated now may not reflect conditions at departure time. Always obtain up-to-date forecasts and check for NOTAMs and local hazards.</p>
    <p>This plugin <strong>does not replace good seamanship</strong>, a qualified navigator, or certified navigation software. Use is entirely at your own risk.</p>
    <button onclick={accept}>I understand — continue</button>
  </div>
</div>
{/if}

<style>
  .disclaimer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }
  .disclaimer-box {
    background: #1e2230;
    border: 2px solid #f38ba8;
    border-radius: 8px;
    padding: 24px;
    max-width: 500px;
    color: #cdd6f4;
  }
  .disclaimer-box h2 { color: #f38ba8; margin-bottom: 12px; }
  .disclaimer-box p { margin-bottom: 8px; font-size: 13px; line-height: 1.5; }
</style>
