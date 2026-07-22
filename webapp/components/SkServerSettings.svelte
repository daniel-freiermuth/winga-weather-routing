<script lang="ts">
  interface Props {
    currentUrl: string;
  }
  let { currentUrl }: Props = $props();

  let value = $state(currentUrl);

  function handleChange() {
    let val = value.trim().replace(/\/+$/, '');
    if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
      val = 'http://' + val;
    }
    if (val) localStorage.setItem('wr-signalk-url', val);
    else localStorage.removeItem('wr-signalk-url');
    location.reload();
  }
</script>

<div class="sk-settings">
  <div class="section-title">SignalK Server</div>
  <input
    type="text"
    placeholder="auto (same origin)"
    bind:value={value}
    onchange={handleChange}
  />
  <span class="hint">
    Leave empty when installed as SK webapp. Set to e.g.
    <code>http://192.168.1.100:3000</code> for standalone use.
  </span>
</div>

<style>
  .sk-settings { display: flex; flex-direction: column; gap: 2px; }
  .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #a6adc8; }
  input {
    font-size: 11px; padding: 4px 6px; width: 100%;
    background: #313244; color: #cdd6f4;
    border: 1px solid #45475a; border-radius: 3px;
  }
  .hint { font-size: 10px; color: #6c7086; margin-top: 2px; }
  code { background: #313244; padding: 1px 3px; border-radius: 2px; }
</style>
