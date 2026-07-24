<script lang="ts">
  interface Waypoint {
    lat: number;
    lon: number;
    bearing: number;
    distanceNm: number;
    eta: string;
  }

  interface Props {
    waypoints: Waypoint[];
    totalDistanceNm: number;
    totalDurationH: number;
    departureTime: string;
    statusText: string;
    statusType: string;
    canSave: boolean;
    onEdit: () => void;
    onSave: () => void;
  }

  let {
    waypoints,
    totalDistanceNm,
    totalDurationH,
    departureTime,
    statusText,
    statusType,
    canSave,
    onEdit,
    onSave,
  }: Props = $props();

  function fmtShortDateTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ', '
      + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtDuration(h: number): string {
    if (h < 24) return `~${h.toFixed(1)} h`;
    const days = Math.floor(h / 24);
    const rem = h - days * 24;
    return `~${days}d ${rem.toFixed(0)}h`;
  }

  let arrivalTime = $derived(
    waypoints.length > 0 ? waypoints[waypoints.length - 1]!.eta : ''
  );
</script>

<div class="route-summary">
  <div class="header">Route Summary</div>

  <div class="overview">
    <div class="time-row">
      <span class="label">Departure:</span>
      <span class="value">{fmtShortDateTime(departureTime)}</span>
      <span class="arrow">→</span>
      <span class="label">Arrival:</span>
      <span class="value">{arrivalTime ? fmtShortDateTime(arrivalTime) : '—'}</span>
    </div>
    <div class="totals">
      Total: {totalDistanceNm.toFixed(1)} nm, {fmtDuration(totalDurationH)}
    </div>
  </div>

  <div class="wp-table-wrap">
    <table class="wp-table">
      <thead>
        <tr>
          <th class="col-wp">WP</th>
          <th class="col-bearing">Bearing</th>
          <th class="col-dist">Dist</th>
          <th class="col-eta">ETA</th>
        </tr>
      </thead>
      <tbody>
        {#each waypoints as wp, i}
          <tr>
            <td class="col-wp">{i + 1}</td>
            <td class="col-bearing">{i === 0 ? '---' : `${Math.round(wp.bearing)}°`}</td>
            <td class="col-dist">{i === 0 ? '---' : wp.distanceNm.toFixed(1)}</td>
            <td class="col-eta">{fmtShortDateTime(wp.eta)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="actions">
    <button class="save-btn" disabled={!canSave} onclick={onSave}>Save to SignalK</button>
    <button class="edit-btn" onclick={onEdit}>Edit</button>
  </div>

  {#if statusText}
    <div class="status-bar {statusType}">{statusText}</div>
  {/if}
</div>

<style>
  .route-summary {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-size: 12px;
    color: #cdd6f4;
  }

  .header {
    font-size: 13px;
    font-weight: 600;
    padding: 10px 12px;
    border-bottom: 1px solid #45475a;
  }

  .overview {
    padding: 8px 12px;
    border-bottom: 1px solid #45475a;
  }

  .time-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }

  .time-row .label {
    color: #6c7086;
  }

  .time-row .value {
    color: #cdd6f4;
  }

  .time-row .arrow {
    color: #6c7086;
    margin: 0 2px;
  }

  .totals {
    margin-top: 4px;
    font-size: 11px;
    color: #a6adc8;
  }

  .wp-table-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 12px;
  }

  .wp-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }

  .wp-table thead {
    position: sticky;
    top: 0;
    background: #2a2f45;
  }

  .wp-table th {
    padding: 6px 4px;
    font-weight: 500;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-size: 10px;
    border-bottom: 1px solid #45475a;
  }

  .wp-table td {
    padding: 4px;
    border-bottom: 1px solid rgba(69, 71, 90, 0.4);
  }

  .wp-table tbody tr:hover {
    background: rgba(137, 180, 250, 0.05);
  }

  .col-wp {
    width: 32px;
    color: #89b4fa;
    text-align: left;
  }

  .col-bearing {
    width: 56px;
    text-align: right;
  }

  .col-dist {
    width: 48px;
    text-align: right;
  }

  .col-eta {
    text-align: left;
    padding-left: 8px !important;
  }

  .actions {
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid #45475a;
  }

  .save-btn {
    flex: 1;
    padding: 7px 12px;
    background: #a6e3a1;
    color: #1e1e2e;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .save-btn:hover {
    filter: brightness(1.1);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: none;
  }

  .edit-btn {
    padding: 7px 12px;
    background: #313244;
    color: #cdd6f4;
    border: 1px solid #45475a;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .edit-btn:hover {
    background: #45475a;
  }

  .status-bar {
    padding: 8px 12px;
    font-size: 11px;
    color: #6c7086;
    border-top: 1px solid #45475a;
    background: #1e2230;
  }

  .status-bar.error {
    color: #f38ba8;
  }

  .status-bar.success {
    color: #a6e3a1;
  }

  .status-bar.progress {
    color: #89b4fa;
  }
</style>
