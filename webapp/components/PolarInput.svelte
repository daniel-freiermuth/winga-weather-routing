<script lang="ts">
  let status = $state(localStorage.getItem('wr-polar-csv') ? 'Polar loaded from previous session' : 'No polar loaded');
  let statusColor = $state(localStorage.getItem('wr-polar-csv') ? '#a6e3a1' : '#6c7086');

  let upwind = $state('');
  let beam = $state('');
  let downwind = $state('');

  interface Props {
    onchange?: () => void;
  }
  let { onchange }: Props = $props();

  // Restore polar from localStorage on init
  const savedPolar = localStorage.getItem('wr-polar-csv');
  if (savedPolar) window._polarCsv = savedPolar;

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const csv = await file.text();
    localStorage.setItem('wr-polar-csv', csv);
    window._polarCsv = csv;
    status = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    statusColor = '#a6e3a1';
    onchange?.();
  }

  function generatePolar() {
    const u = parseFloat(upwind);
    const b = parseFloat(beam);
    const d = parseFloat(downwind);
    if (isNaN(u) || isNaN(b) || isNaN(d)) {
      status = 'Enter all three speeds';
      statusColor = '#f38ba8';
      return;
    }

    const refTws = 12;
    const twsValues = [6, 8, 10, 12, 14, 16, 20, 25];
    const twaValues = [30, 45, 60, 75, 90, 110, 130, 150, 170, 180];

    // Smooth cosine interpolation between anchor points
    const speedAtTwa = (twa: number): number => {
      if (twa <= 45) return u * Math.max(0, (twa - 30) / 15);
      if (twa <= 90) return u + (b - u) * (1 - Math.cos(((twa - 45) / 45) * Math.PI)) / 2;
      if (twa <= 150) return b + (d - b) * (1 - Math.cos(((twa - 90) / 60) * Math.PI)) / 2;
      return d * (1 - 0.15 * ((twa - 150) / 30));
    };

    let csv = 'twa/tws;' + twsValues.join(';') + '\n';
    for (const twa of twaValues) {
      const base = speedAtTwa(twa);
      const row = twsValues.map(tws => (base * Math.min(1.3, Math.sqrt(tws / refTws))).toFixed(1));
      csv += String(twa) + ';' + row.join(';') + '\n';
    }

    localStorage.setItem('wr-polar-csv', csv);
    window._polarCsv = csv;
    status = `Generated: ${String(u)}/${String(b)}/${String(d)} kn (upwind/beam/downwind)`;
    statusColor = '#a6e3a1';
    onchange?.();
  }
</script>

<div class="polar-input">
  <div class="section-title">Polar Diagram</div>

  <input type="file" accept=".csv,.pol,.txt" onchange={handleFileUpload} />

  <span class="status" style:color={statusColor}>{status}</span>

  <div class="estimate-label">Or estimate from typical speeds:</div>

  <div class="speed-grid">
    <span>Upwind</span>
    <input type="number" step="0.1" min="0" placeholder="kn" bind:value={upwind} />
    <span class="unit">kn</span>

    <span>Beam</span>
    <input type="number" step="0.1" min="0" placeholder="kn" bind:value={beam} />
    <span class="unit">kn</span>

    <span>Downwind</span>
    <input type="number" step="0.1" min="0" placeholder="kn" bind:value={downwind} />
    <span class="unit">kn</span>
  </div>

  <button class="generate-btn" onclick={generatePolar}>Generate polar</button>
</div>

<style>
  .polar-input { display: flex; flex-direction: column; gap: 4px; }
  .section-title { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #a6adc8; }
  input[type="file"] { font-size: 12px; }
  .status { font-size: 11px; margin-top: 2px; display: block; }
  .estimate-label { margin-top: 6px; font-size: 11px; color: #a6adc8; }
  .speed-grid {
    display: grid; grid-template-columns: auto 1fr auto;
    gap: 3px 6px; align-items: center; margin-top: 4px; font-size: 12px;
  }
  .speed-grid input {
    width: 100%; padding: 3px 5px;
    background: #313244; color: #cdd6f4;
    border: 1px solid #45475a; border-radius: 3px; font-size: 12px;
  }
  .unit { color: #6c7086; }
  .generate-btn {
    margin-top: 4px; font-size: 11px; padding: 3px 8px;
    background: #585b70; color: #cdd6f4;
    border: none; border-radius: 3px; cursor: pointer;
  }
  .generate-btn:hover { background: #6c7086; }
</style>
