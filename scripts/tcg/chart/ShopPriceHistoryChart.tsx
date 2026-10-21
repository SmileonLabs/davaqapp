"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { IChartApi, Time } from 'lightweight-charts';
import type { ShopMarketHistoryPoint } from './types';
import { historyAverage, historyRange, historySeries } from './price-history-series';


function seriesLabel(p: ShopMarketHistoryPoint, en: boolean) {
  if (p.shopCode.startsWith('cardmarket-')) return `Cardmarket · ${p.shopCode.includes('foil') ? (en ? 'Foil' : '홀로') : (en ? 'Regular' : '일반')} · ${en ? 'Trend price' : '참고 시세'}`;
  return [p.shopName, p.conditionLabel, p.gradingLabel, p.priceType === 'SOLD' ? (en ? 'Completed sales' : '체결가') : p.shopCode === 'kream' ? (en ? 'Asking price' : '등록가') : (en ? 'Reference price' : '참고가'), p.shopCode === 'justtcg-reference' ? null : `#${p.sourceProductId}`].filter(Boolean).join(' · ');
}

function dateLabel(time: Time) {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export function ShopPriceHistoryChart({ points, initialSeriesId }: { points: readonly ShopMarketHistoryPoint[]; initialSeriesId?: string | undefined }) {
  const en = false, f = { money: (value: number, currency: string) => new Intl.NumberFormat('ko-KR', {style:'currency',currency,maximumFractionDigits:currency==='KRW'?0:2}).format(value) };
  const groups = useMemo(() => historySeries(points), [points]);
  const [selected, setSelected] = useState(''), [comparison, setComparison] = useState('');
  const [days, setDays] = useState(0), [kind, setKind] = useState<'area' | 'line'>('area');
  const [average, setAverage] = useState(false), [logarithmic, setLogarithmic] = useState(false), [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<{ date: string; value?: number; comparison?: number } | null>(null);
  const host = useRef<HTMLDivElement>(null), chart = useRef<IChartApi | null>(null);
  const active = groups.find(g => g.key === selected) ?? groups.find(g => g.sample.sourceProductId === initialSeriesId) ?? groups[0];
  const currency = active?.sample.currencyCode ?? 'KRW';
  const alternatives = groups.filter(g => g.key !== active?.key && g.sample.currencyCode === currency);
  const compared = alternatives.find(g => g.key === comparison);
  const values = useMemo(() => historyRange(active?.values ?? [], days), [active, days]);
  const latest = values.at(-1), first = values[0];
  const money = (value: number) => f.money(value, currency);
  const change = latest && first?.value ? (latest.value / first.value - 1) * 100 : null;

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', escape); };
  }, [expanded]);

  useEffect(() => {
    if (!host.current || !active || !values.length) return;
    let disposed = false, instance: IChartApi | null = null, themeObserver: MutationObserver | null = null;
    setStatus('loading'); setHover(null);
    void import('lightweight-charts').then(lib => {
      if (disposed || !host.current) return;
      const palette = () => {
        const css = getComputedStyle(document.documentElement);
        const token = (name: string) => css.getPropertyValue(name).trim();
        return { surface: token('--ui-surface'), text: token('--ui-text-muted'), border: token('--ui-border'), brand: token('--ui-brand'), warning: token('--ui-warning'), positive: token('--ui-positive') };
      };
      const colors = palette();
      instance = lib.createChart(host.current, {
        autoSize: true,
        layout: { background: { type: lib.ColorType.Solid, color: colors.surface }, textColor: colors.text, fontFamily: 'system-ui, sans-serif', fontSize: 12, attributionLogo: true },
        grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
        crosshair: { mode: lib.CrosshairMode.Normal },
        localization: { locale: en ? 'en-US' : 'ko-KR', priceFormatter: (value: number) => new Intl.NumberFormat(en ? 'en-US' : 'ko-KR', { style: 'currency', currency, maximumFractionDigits: ['KRW', 'JPY'].includes(currency) ? 0 : 2 }).format(value), dateFormat: 'yyyy-MM-dd' },
        rightPriceScale: { borderColor: colors.border, minimumWidth: 80, mode: logarithmic ? lib.PriceScaleMode.Logarithmic : lib.PriceScaleMode.Normal },
        timeScale: { borderColor: colors.border, rightOffset: 3, minBarSpacing: 0.05 },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      });
      chart.current = instance;
      const main = kind === 'area'
        ? instance.addSeries(lib.AreaSeries, { lineColor: colors.brand, topColor: `${colors.brand}33`, bottomColor: `${colors.brand}00`, lineWidth: 2, pointMarkersVisible: values.length === 1, pointMarkersRadius: 5 })
        : instance.addSeries(lib.LineSeries, { color: colors.brand, lineWidth: 2, pointMarkersVisible: values.length === 1, pointMarkersRadius: 5 });
      main.setData(values);
      const second = compared ? instance.addSeries(lib.LineSeries, { color: colors.warning, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }) : null;
      if (second && compared) second.setData(compared.values.filter(p => p.time >= values[0]!.time && p.time <= values[values.length - 1]!.time));
      const mean = average ? instance.addSeries(lib.LineSeries, { color: colors.positive, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }) : null;
      if (mean) {
        mean.setData(historyAverage(active.values).filter(p => p.time >= values[0]!.time));
      }
      const applyPalette = () => {
        if (disposed || !instance) return;
        const c = palette();
        instance.applyOptions({ layout: { background: { type: lib.ColorType.Solid, color: c.surface }, textColor: c.text }, grid: { vertLines: {color: c.border}, horzLines: {color: c.border} }, rightPriceScale: {borderColor: c.border}, timeScale: {borderColor: c.border}, crosshair: {vertLine: {color: c.text, labelBackgroundColor: c.border}, horzLine: {color: c.text, labelBackgroundColor: c.border}} });
        main.applyOptions(kind === 'area' ? {lineColor: c.brand, topColor: `${c.brand}40`, bottomColor: `${c.brand}00`} : {color: c.brand});
        second?.applyOptions({color: c.warning});
        mean?.applyOptions({color: c.positive});
      };
      applyPalette();
      themeObserver = new MutationObserver(applyPalette);
      themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
      instance.subscribeCrosshairMove(event => {
        if (!event.time || !event.point || event.point.x < 0 || event.point.y < 0) { setHover(null); return; }
        const a = event.seriesData.get(main), b = second ? event.seriesData.get(second) : null;
        setHover({ date: dateLabel(event.time), ...(a && 'value' in a && typeof a.value === 'number' ? { value: a.value } : {}), ...(b && 'value' in b && typeof b.value === 'number' ? { comparison: b.value } : {}) });
      });
      instance.timeScale().fitContent();
      setStatus('ready');
    }).catch(() => {
      if (!disposed) { instance?.remove(); instance = null; chart.current = null; setStatus('error'); }
    });
    return () => { disposed = true; themeObserver?.disconnect(); instance?.remove(); chart.current = null; };
  }, [active, compared, values, currency, en, kind, average, logarithmic, retry]);

  function zoom(factor: number) {
    const scale = chart.current?.timeScale(), range = scale?.getVisibleLogicalRange();
    if (!scale || !range) return;
    const center = (range.from + range.to) / 2, span = Math.max(3, (range.to - range.from) * factor);
    scale.setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 });
  }
  if (!active || !latest) return <p>{en ? 'No price history yet.' : '아직 기록된 가격이 없습니다.'}</p>;
  return <section className={`tradingPriceChart${expanded ? ' isExpanded' : ''}`} aria-label={en ? 'Interactive price history' : '가격 변화 차트'}>
    <div className="tradingChartHeading"><div><span className="exchangeEyebrow">PRICE HISTORY · {currency}</span><h3>{seriesLabel(active.sample, en)}</h3></div><button type="button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? (en ? 'Close full screen' : '전체 화면 닫기') : (en ? 'Full screen' : '전체 화면')}</button></div>
    <div className="tradingChartQuote"><strong>{money(latest.value)}</strong><span>{latest.time} · {en ? 'Latest record' : '최근 기록'}</span>{change !== null ? <b className={change > 0 ? 'isUp' : change < 0 ? 'isDown' : ''}>{change > 0 ? '+' : ''}{change.toFixed(2)}% <small>{en ? 'selected period' : '선택 기간'}</small></b> : null}</div>
    <div className="tradingChartSelectors"><label>{en ? 'Price to display' : '보고 싶은 가격'}<select value={active.key} onChange={event => { setSelected(event.target.value); setComparison(''); }}>
      {groups.map(g => <option key={g.key} value={g.key}>{g.sample.currencyCode} · {seriesLabel(g.sample, en)}</option>)}
    </select></label>{alternatives.length ? <label>{en ? 'Compare in the same currency' : '같은 통화로 비교'}<select value={compared?.key ?? ''} onChange={event => setComparison(event.target.value)}><option value="">{en ? 'No comparison' : '비교 안 함'}</option>{alternatives.map(g => <option key={g.key} value={g.key}>{seriesLabel(g.sample, en)}</option>)}</select></label> : null}</div>
    <div className="tradingChartToolbar"><div role="group" aria-label={en ? 'Period' : '기간'}>{[7, 30, 90, 365, 0].map(value => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value === 0 ? (en ? 'All' : '전체') : value === 365 ? (en ? '1Y' : '1년') : `${value}${en ? 'D' : '일'}`}</button>)}</div><div role="group" aria-label={en ? 'Chart display' : '차트 표시'}><button type="button" aria-pressed={kind === 'line'} onClick={() => setKind(kind === 'area' ? 'line' : 'area')}>{kind === 'area' ? (en ? 'Area' : '영역') : (en ? 'Line' : '선')}</button><button type="button" aria-pressed={average} onClick={() => setAverage(!average)}>{en ? '7-record average' : '7개 기록 평균'}</button><button type="button" aria-pressed={logarithmic} onClick={() => setLogarithmic(!logarithmic)}>{en ? 'Log scale' : '로그 눈금'}</button></div></div>
    <div className="tradingChartReadout"><time>{hover?.date ?? latest.time}</time><strong>{hover ? (hover.value === undefined ? '—' : money(hover.value)) : money(latest.value)}</strong>{compared ? <span className="comparisonLegend">{seriesLabel(compared.sample, en)}{hover?.comparison !== undefined ? ` · ${money(hover.comparison)}` : ''}</span> : null}{average ? <span className="averageLegend">{en ? '7-record average' : '7개 기록 평균'}</span> : null}</div>
    <div className="tradingChartCanvas" ref={host} role="img" aria-label={`${seriesLabel(active.sample, en)} · ${values[0]!.time} ~ ${latest.time}`} />
    {status !== 'ready' ? <p className="tradingChartStatus" role="status">{status === 'loading' ? (en ? 'Loading chart… Price records are available below.' : '차트를 불러오고 있어요. 아래에서 가격 기록도 볼 수 있습니다.') : <>{en ? 'Unable to load chart.' : '차트를 불러오지 못했습니다.'} <button type="button" onClick={() => setRetry(retry + 1)}>{en ? 'Retry' : '다시 불러오기'}</button></>}</p> : null}
    <div className="tradingChartNavigation"><span>{en ? 'Drag to move · Scroll or pinch to zoom' : '드래그로 이동 · 휠 또는 두 손가락으로 확대'}</span><div><button type="button" aria-label={en ? 'Zoom in' : '확대'} onClick={() => zoom(0.65)}>＋</button><button type="button" aria-label={en ? 'Zoom out' : '축소'} onClick={() => zoom(1.5)}>−</button><button type="button" onClick={() => chart.current?.timeScale().fitContent()}>{en ? 'Reset view' : '화면 맞춤'}</button></div></div>
    <dl className="tradingChartStats"><div><dt>{en ? 'Period low' : '기간 최저'}</dt><dd>{money(values.reduce((min, p) => Math.min(min, p.value), Infinity))}</dd></div><div><dt>{en ? 'Period high' : '기간 최고'}</dt><dd>{money(values.reduce((max, p) => Math.max(max, p.value), -Infinity))}</dd></div><div><dt>{en ? 'Recorded dates' : '가격 기록'}</dt><dd>{values.length.toLocaleString()}<small>{en ? ' dates' : '일'}</small></dd></div></dl>
    <p className="tradingChartNote">{en ? 'Periods end at the latest recorded date. Lines connect available observations; missing dates are not estimated.' : '기간은 최근 기록일 기준입니다. 선은 실제 가격 기록을 연결하며, 누락된 날짜의 가격을 만들어 채우지 않습니다.'}</p>
    <details className="tradingChartData"><summary>{en ? 'View price records' : '날짜별 가격 기록 보기'} · {values.length.toLocaleString()}</summary><div><table><thead><tr><th>{en ? 'Date' : '날짜'}</th><th>{en ? 'Price' : '가격'} · {currency}</th></tr></thead><tbody>{values.slice(-500).reverse().map(p => <tr key={p.time}><td>{p.time}</td><td>{money(p.value)}</td></tr>)}</tbody></table></div>{values.length > 500 ? <p>{en ? 'Showing the latest 500 records.' : '최근 500개 기록을 표시합니다.'}</p> : null}</details>
    <p className="tradingChartAttribution"><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a> · Copyright © 2025 TradingView, Inc. · <a href="https://github.com/tradingview/lightweight-charts/blob/v5.2.0/LICENSE" target="_blank" rel="noreferrer">Apache 2.0</a></p>
  </section>;
}
