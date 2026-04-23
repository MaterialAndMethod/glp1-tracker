import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FilePicker } from "@capawesome/capacitor-file-picker";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

const DRUGS = {
  Semaglutide: 7,
  Tirzepatide: 5,
  Custom: 5,
};
const LEGACY_DRUG_ALIASES = {
  Ozempic: "Semaglutide",
  Wegovy: "Semaglutide",
};

const STORAGE_KEY = "glp1Data";
const MAX_PROJECTION_DAYS = 180;
const SUBJECTIVE_SCALE_OPTIONS = Array.from({ length: 11 }, (_, i) => i);
const PROJECTION_INTERVAL_DAYS = 7;
const IS_NATIVE_APP = Capacitor.isNativePlatform();
const PAGE_OPTIONS = [
  { key: "medication", label: "Medication Update", blurb: "Weekly shot details and quick summary" },
  { key: "metrics", label: "Nutrition & Metrics", blurb: "Daily entry, nutrition, and symptoms" },
  { key: "charts", label: "Charts", blurb: "Heatmap and Trend Explorer" },
];
const OVERLAY_OPTIONS = [
  { key: "medLevel", label: "Medication Level" },
  { key: "weightVsMed", label: "Weight vs Medication Level" },
  { key: "foodNoiseVsMed", label: "Food Noise vs Medication Level" },
  { key: "hungerVsMed", label: "Hunger vs Medication Level" },
  { key: "nauseaVsMed", label: "Nausea vs Medication Level" },
  { key: "nutrition", label: "Calories, Protein, Fat, and Fiber" },
];
const SUBJECTIVE_AXIS_DOMAIN = [0, 10];
const CHART_COLORS = {
  medication: "#d4a72c",
  purple: "#8b5cf6",
  goldSoft: "#f3deb0",
  lavender: "#c4b5fd",
};
const SUBJECTIVE_OVERLAY_CONFIG = {
  foodNoiseVsMed: { key: "foodNoise", label: "Food Noise" },
  hungerVsMed: { key: "hunger", label: "Hunger" },
  nauseaVsMed: { key: "nausea", label: "Nausea" },
};

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayDateString() {
  return formatDateKey(new Date());
}

function parseEntryDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const initialForm = {
  date: getTodayDateString(),
  weight: "",
  lastDose: "",
  drug: "Semaglutide",
  shotLocation: "Left thigh",
  dosage: "0.25",
  calories: "",
  protein: "",
  fiber: "",
  fat: "",
  medLevel: "",
  nausea: "",
  foodNoise: "",
  hunger: "",
};

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const aDate = parseEntryDate(a.date);
    const bDate = parseEntryDate(b.date);
    if (!aDate && !bDate) return 0;
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate - bDate;
  });
}

function calcDecay(doseMg, daysElapsed, halfLife) {
  if (!doseMg || !Number.isFinite(daysElapsed) || daysElapsed < 0) return 0;
  return doseMg * Math.pow(0.5, daysElapsed / halfLife);
}

function getFiniteNumber(value) {
  if (value === "" || value == null) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function movingAvg(data, key, window = 3) {
  return data.map((_, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1);
    const values = slice.map((d) => getFiniteNumber(d[key])).filter((v) => v != null);
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    return { ...data[i], [`${key}_avg`]: Number(avg.toFixed(2)) };
  });
}

function normalizeDrugName(drugName) {
  if (!drugName) return initialForm.drug;
  return LEGACY_DRUG_ALIASES[drugName] || drugName;
}

function getExperimentalHalfLife(entry) {
  const normalizedDrug = normalizeDrugName(entry?.drug);
  const baseHalfLife = DRUGS[normalizedDrug] || DRUGS.Custom;
  if (normalizedDrug !== "Semaglutide") return baseHalfLife;

  const weight = Number(entry?.weight || 0);
  if (!weight || Number.isNaN(weight)) return baseHalfLife;

  const baselineWeight = 220;
  const weightAdjustment = Math.pow(baselineWeight / weight, 0.08);
  const boundedAdjustment = Math.max(0.92, Math.min(1.08, weightAdjustment));
  return Number((baseHalfLife * boundedAdjustment).toFixed(2));
}

function getLatestMedicationDefaults(data) {
  if (!data.length) {
    return {
      drug: initialForm.drug,
      shotLocation: initialForm.shotLocation,
      lastDose: initialForm.lastDose,
      dosage: initialForm.dosage,
    };
  }

  const sortedEntries = sortEntries(data);
  const latestEntry = sortedEntries[sortedEntries.length - 1];
  return {
    drug: latestEntry.drug || initialForm.drug,
    shotLocation: latestEntry.shotLocation || initialForm.shotLocation,
    lastDose: latestEntry.lastDose || initialForm.lastDose,
    dosage: latestEntry.dosage || initialForm.dosage,
  };
}

function buildStickyForm(data, overrides = {}) {
  return {
    ...initialForm,
    ...getLatestMedicationDefaults(data),
    date: getTodayDateString(),
    ...overrides,
  };
}

function triggerBrowserDownload(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportTextFile(content, mimeType, filename) {
  if (!IS_NATIVE_APP) {
    triggerBrowserDownload(content, mimeType, filename);
    return { method: "download" };
  }

  const result = await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
  });

  await Share.share({
    title: filename,
    dialogTitle: `Share ${filename}`,
    url: result.uri,
  });

  return { method: "share", uri: result.uri };
}

function decodeBase64Text(base64Value) {
  const sanitized = base64Value.includes(",") ? base64Value.split(",").pop() : base64Value;
  const binary = window.atob(sanitized || "");
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function pickJsonTextFromNativeFilePicker() {
  const result = await FilePicker.pickFiles({
    limit: 1,
    readData: true,
    types: ["application/json", "public.json"],
  });

  const selectedFile = result.files?.[0];
  if (!selectedFile) return null;

  if (selectedFile.data) {
    return {
      name: selectedFile.name || "glp1-data.json",
      text: decodeBase64Text(selectedFile.data),
    };
  }

  if (selectedFile.path) {
    const fileContents = await Filesystem.readFile({
      path: selectedFile.path,
    });

    return {
      name: selectedFile.name || "glp1-data.json",
      text:
        typeof fileContents.data === "string"
          ? decodeBase64Text(fileContents.data)
          : new TextDecoder().decode(fileContents.data),
    };
  }

  return null;
}

async function exportCSV(data) {
  if (!data.length) return null;
  const headers = Object.keys(data[0]);
  const rows = data.map((d) => headers.map((h) => JSON.stringify(d[h] ?? "")).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  return exportTextFile(csv, "text/csv;charset=utf-8", "glp1_data.csv");
}

async function downloadJsonFile(data) {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    entries: data,
  };
  const fileName = `glp1-tracker-data-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
  return exportTextFile(JSON.stringify(payload, null, 2), "application/json;charset=utf-8", fileName);
}

function normalizeLoadedData(raw) {
  const entries = Array.isArray(raw) ? raw : raw && Array.isArray(raw.entries) ? raw.entries : [];
  return entries.map((entry) => ({
    ...entry,
    drug: normalizeDrugName(entry?.drug),
  }));
}

function parseImportedEntries(rawText) {
  return sortEntries(normalizeLoadedData(JSON.parse(rawText)));
}

function calcWeightRate(data) {
  const weights = sortEntries(data).filter((d) => Number.isFinite(Number(d.weight)));
  if (weights.length < 2) return 0;
  const first = weights[0];
  const last = weights[weights.length - 1];
  const firstDate = parseEntryDate(first.date);
  const lastDate = parseEntryDate(last.date);
  if (!firstDate || !lastDate) return 0;
  const days = (lastDate - firstDate) / 86400000;
  if (!days) return 0;
  return ((Number(first.weight) - Number(last.weight)) / days) * 7;
}

function estimateCalorieDeficit(rate) {
  return (rate * 3500) / 7;
}

function predictNextDose(data) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const actualEntries = sortEntries(data).filter((entry) => {
    const entryDate = parseEntryDate(entry.date);
    return entry.lastDose && entryDate && entryDate <= today;
  });

  if (!actualEntries.length) return "No data";
  const last = actualEntries[actualEntries.length - 1];
  const d = parseEntryDate(last.lastDose);
  if (!d) return "No data";
  d.setDate(d.getDate() + PROJECTION_INTERVAL_DAYS);
  return d.toLocaleString();
}

function getMetricScore(entry) {
  const symptoms = [Number(entry.nausea || 0), Number(entry.foodNoise || 0), Number(entry.hunger || 0)];
  const avgSymptoms = symptoms.reduce((a, b) => a + b, 0) / symptoms.length || 0;
  const dosage = Number(entry.dosage || 0);
  return {
    adherence: dosage > 0 ? 1 : 0,
    symptomScore: Number(avgSymptoms.toFixed(2)),
    intensityScore: Number(avgSymptoms.toFixed(2)),
  };
}

function getHeatColor(_level, dark, hasEntry = false) {
  if (!hasEntry) return dark ? "#1f2937" : "#f3f4f6";
  return dark ? "#8b5cf6" : "#c4b5fd";
}

function buildCalendarCells(data, offsetDays = 0) {
  const byDate = new Map(data.map((entry) => [entry.date, entry]));
  const today = new Date();
  const anchorDate = new Date(today);
  anchorDate.setDate(today.getDate() + offsetDays);
  const cells = [];

  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(anchorDate);
    d.setDate(anchorDate.getDate() - i);
    const date = formatDateKey(d);
    const day = byDate.get(date);
    const score = day ? getMetricScore(day) : { adherence: 0, symptomScore: 0, intensityScore: 0 };
    cells.push({
      date,
      weekdayLabel: d.toLocaleString(undefined, { weekday: "short" }),
      dayLabel: d.getDate(),
      entry: day,
      ...score,
    });
  }

  return cells;
}

function getPaddedYAxisDomain(data, keys, fallback = [0, 1]) {
  const values = data.flatMap((entry) =>
    keys.map((key) => getFiniteNumber(entry[key])).filter((v) => v != null)
  );

  if (!values.length) return fallback;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (minValue === maxValue) {
    const padding = Math.max(Math.abs(minValue) * 0.05, 1);
    return [minValue - padding, maxValue + padding];
  }

  return [minValue - Math.abs(minValue) * 0.05, maxValue + Math.abs(maxValue) * 0.05];
}

function getDateEnd(value) {
  const parsed = parseEntryDate(value);
  if (!parsed) return null;
  parsed.setHours(23, 59, 59, 999);
  return parsed;
}

function getMedicationEvents(data) {
  const eventMap = new Map();

  sortEntries(data).forEach((entry) => {
    const doseDate = parseEntryDate(entry.lastDose);
    const dosageMg = getFiniteNumber(entry.dosage);
    if (!doseDate || dosageMg == null || dosageMg <= 0) return;

    eventMap.set(doseDate.toISOString(), {
      doseDate,
      dosageMg,
      halfLife: getExperimentalHalfLife(entry),
    });
  });

  return [...eventMap.values()].sort((a, b) => a.doseDate - b.doseDate);
}

function calculateMedicationLevelForDate(date, events) {
  const targetDate = getDateEnd(date);
  if (!targetDate || !events.length) return "";

  const totalLevel = events.reduce((sum, event) => {
    const daysSinceDose = (targetDate - event.doseDate) / 86400000;
    if (daysSinceDose < 0) return sum;
    return sum + calcDecay(event.dosageMg, daysSinceDose, event.halfLife);
  }, 0);

  return Number(totalLevel.toFixed(2));
}

function enrichEntriesWithMedicationLevels(data) {
  if (!data.length) return [];

  const sorted = sortEntries(data);
  const events = getMedicationEvents(sorted);

  return sorted.map((entry) => ({
    ...entry,
    medLevel: calculateMedicationLevelForDate(entry.date, events),
  }));
}

function buildMedicationLevelSeries(data, daysToProject = 0) {
  if (!data.length) return [];

  const enrichedEntries = enrichEntriesWithMedicationLevels(data);
  const medicationEvents = getMedicationEvents(enrichedEntries);
  if (!medicationEvents.length) return [];

  const entriesByDate = new Map(enrichedEntries.map((entry) => [entry.date, entry]));
  const firstDoseDate = parseEntryDate(formatDateKey(medicationEvents[0].doseDate));
  const lastTrackedDate = parseEntryDate(enrichedEntries[enrichedEntries.length - 1]?.date);
  const lastMedicationEvent = medicationEvents[medicationEvents.length - 1];

  if (!firstDoseDate || !lastTrackedDate) return [];

  const finalTimelineDate = new Date(lastTrackedDate);
  finalTimelineDate.setDate(lastTrackedDate.getDate() + daysToProject);

  const timeline = [];

  for (let cursor = new Date(firstDoseDate); cursor <= finalTimelineDate; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatDateKey(cursor);
    const isProjection = cursor > lastTrackedDate;
    const projectedDateEnd = getDateEnd(date);
    let projectedLevel = calculateMedicationLevelForDate(date, medicationEvents);

    if (isProjection && projectedDateEnd) {
      const recurringDoseCount = Math.floor(
        (projectedDateEnd - lastMedicationEvent.doseDate) / 86400000 / PROJECTION_INTERVAL_DAYS
      );

      for (let doseIndex = 1; doseIndex <= recurringDoseCount; doseIndex += 1) {
        const recurringDoseDate = new Date(lastMedicationEvent.doseDate);
        recurringDoseDate.setDate(lastMedicationEvent.doseDate.getDate() + doseIndex * PROJECTION_INTERVAL_DAYS);
        const daysSinceDose = (projectedDateEnd - recurringDoseDate) / 86400000;
        if (daysSinceDose >= 0) {
          projectedLevel += calcDecay(lastMedicationEvent.dosageMg, daysSinceDose, lastMedicationEvent.halfLife);
        }
      }
    }

    const daysSinceLastDose = projectedDateEnd
      ? (projectedDateEnd - lastMedicationEvent.doseDate) / 86400000
      : 0;
    const nextDoseNumber = Math.max(1, Math.floor(daysSinceLastDose / PROJECTION_INTERVAL_DAYS) + 1);
    const nextProjectedInjectionDate = new Date(lastMedicationEvent.doseDate);
    nextProjectedInjectionDate.setDate(
      lastMedicationEvent.doseDate.getDate() + nextDoseNumber * PROJECTION_INTERVAL_DAYS
    );

    timeline.push({
      ...(entriesByDate.get(date) || {}),
      date,
      medLevel: Number(projectedLevel.toFixed(2)),
      projectedMedLevel: Number(projectedLevel.toFixed(2)),
      isProjection,
      projectedInjectionDate: formatDateKey(nextProjectedInjectionDate),
      projectedInjectionDose: lastMedicationEvent.dosageMg,
      projectedHalfLife: lastMedicationEvent.halfLife,
    });
  }

  return movingAvg(timeline, "projectedMedLevel");
}

const Field = ({ label, desc, children, compact = false }) => (
  <div className={`field ${compact ? "fieldCompact" : ""}`}>
    <label>{label}</label>
    <small>{desc}</small>
    {children}
  </div>
);

function DotScale({ name, value, onChange }) {
  const numericValue = value === "" ? null : Number(value);
  return (
    <div className="dotScaleWrap">
      <div className="dotScale">
        {SUBJECTIVE_SCALE_OPTIONS.map((option) => {
          const isActive = numericValue === option;
          return (
            <button
              key={`${name}-${option}`}
              type="button"
              className={`dotButton ${isActive ? "dotButtonActive" : ""}`}
              onClick={() => onChange({ target: { name, value: String(option), type: "dot" } })}
              aria-label={`${name} ${option}`}
              title={`${option}`}
            >
              <span>{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CalendarHeatmap({ cells, dark, onSelectDate, selectedDate, offsetDays, onOffsetChange }) {
  const weekStart = cells[0]?.date;
  const weekEnd = cells[cells.length - 1]?.date;

  return (
    <div className="card compactCard fullWidthCard">
      <div className="cardHeaderRow compactHeaderRow">
        <div>
          <h2>This Week</h2>
          <p className="subtle">Daily adherence + symptoms. Click a day to edit.</p>
        </div>
      </div>

      <div className="heatmapScrollerHeader">
        <span className="subtle">{weekStart && weekEnd ? `${weekStart} → ${weekEnd}` : "Current week"}</span>
        <button type="button" className="heatmapTodayBtn" onClick={() => onOffsetChange(0)}>
          Today
        </button>
      </div>

      <div className="heatmapGrid weeklyHeatmapGrid">
        {cells.map((cell) => {
          const isSelected = selectedDate === cell.date;
          return (
            <button
              key={cell.date}
              type="button"
              className={`heatCell compactHeatCell ${isSelected ? "selectedHeatCell" : ""}`}
              style={{ background: getHeatColor(cell.intensityScore, dark, Boolean(cell.entry)) }}
              onClick={() => onSelectDate(cell.date)}
              title={`${cell.date} | ${cell.entry ? `Dose: ${cell.entry.dosage || 0}mg, Nausea: ${cell.entry.nausea || 0}/10, Food Noise: ${cell.entry.foodNoise || 0}/10, Hunger: ${cell.entry.hunger || 0}/10` : "No entry"}`}
            >
              <span className="heatCellWeekday">{cell.weekdayLabel}</span>
              <span className="heatCellDay">{cell.dayLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="heatmapScroller">
        <div className="heatmapScrollerMeta">
          <span className="subtle">Scroll window</span>
          <span className="subtle">{offsetDays === 0 ? "Current week" : `${offsetDays > 0 ? "+" : ""}${offsetDays} day offset`}</span>
        </div>
        <input
          type="range"
          min="-90"
          max="90"
          step="1"
          value={offsetDays}
          className="heatmapRange"
          onChange={(e) => onOffsetChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      return sortEntries(normalizeLoadedData(JSON.parse(saved)));
    } catch {
      return [];
    }
  });
  const [form, setForm] = useState(() => buildStickyForm([]));
  const [dark, setDark] = useState(true);
  const [status, setStatus] = useState("Ready.");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState("medication");
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [editingDate, setEditingDate] = useState(null);
  const [selectedOverlayKey, setSelectedOverlayKey] = useState("weightVsMed");
  const [medicationError, setMedicationError] = useState("");
  const [chartDateRange, setChartDateRange] = useState({ start: "", end: "" });
  const [heatmapOffsetDays, setHeatmapOffsetDays] = useState(0);

  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  const weightRate = useMemo(() => calcWeightRate(data), [data]);
  const estimatedDeficit = useMemo(() => estimateCalorieDeficit(weightRate), [weightRate]);
  const nextDoseText = useMemo(() => predictNextDose(data), [data]);
  const calendarCells = useMemo(() => buildCalendarCells(data, heatmapOffsetDays), [data, heatmapOffsetDays]);

  const chartData = useMemo(() => enrichEntriesWithMedicationLevels(data), [data]);

  const filteredChartData = useMemo(() => {
    if (!chartDateRange.start && !chartDateRange.end) return chartData;
    return chartData.filter((entry) => {
      if (chartDateRange.start && entry.date < chartDateRange.start) return false;
      if (chartDateRange.end && entry.date > chartDateRange.end) return false;
      return true;
    });
  }, [chartData, chartDateRange]);

  const filteredWeightChartData = useMemo(
    () =>
      filteredChartData.map((entry) => ({
        ...entry,
        weight: getFiniteNumber(entry.weight),
      })),
    [filteredChartData]
  );

  const medProjectionConfig = useMemo(() => {
    if (!data.length) {
      return { daysToProject: 14, isCapped: false, cappedEndDate: "" };
    }

    const sorted = sortEntries(data);
    const lastTrackedDate = parseEntryDate(sorted[sorted.length - 1]?.date);

    if (!lastTrackedDate || !chartDateRange.end) {
      return { daysToProject: 14, isCapped: false, cappedEndDate: "" };
    }

    const requestedEndDate = parseEntryDate(chartDateRange.end);
    if (!requestedEndDate || requestedEndDate <= lastTrackedDate) {
      return { daysToProject: 14, isCapped: false, cappedEndDate: "" };
    }

    const requestedDays = Math.ceil((requestedEndDate - lastTrackedDate) / 86400000);
    const daysToProject = Math.max(14, Math.min(MAX_PROJECTION_DAYS, requestedDays));
    const isCapped = requestedDays > MAX_PROJECTION_DAYS;
    const cappedEndDate = isCapped
      ? (() => {
          const capped = new Date(lastTrackedDate);
          capped.setDate(lastTrackedDate.getDate() + MAX_PROJECTION_DAYS);
          return formatDateKey(capped);
        })()
      : "";

    return { daysToProject, isCapped, cappedEndDate };
  }, [data, chartDateRange.end]);

  const filteredProjectedMedLevelData = useMemo(() => {
    const projected = buildMedicationLevelSeries(data, medProjectionConfig.daysToProject);
    return projected.filter((entry) => {
      if (chartDateRange.start && entry.date < chartDateRange.start) return false;
      if (!medProjectionConfig.isCapped && chartDateRange.end && entry.date > chartDateRange.end) return false;
      if (medProjectionConfig.isCapped && medProjectionConfig.cappedEndDate && entry.date > medProjectionConfig.cappedEndDate) return false;
      return true;
    });
  }, [data, chartDateRange, medProjectionConfig]);

  const persistData = (nextData) => {
    setData(nextData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextData));
  };

  const applyImportedData = (nextData, sourceLabel) => {
    persistData(nextData);
    setEditingDate(null);
    setForm(buildStickyForm(nextData));
    setStatus(`Loaded ${nextData.length} entr${nextData.length === 1 ? "y" : "ies"} from ${sourceLabel}.`);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const activePageMeta = PAGE_OPTIONS.find((page) => page.key === activePage) || PAGE_OPTIONS[0];

  const navigateToPage = (pageKey) => {
    setActivePage(pageKey);
    setMenuOpen(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "lastDose" && value) {
      setMedicationError("");
    }
    if (["nausea", "foodNoise", "hunger"].includes(name)) {
      if (value === "") {
        setForm((current) => ({ ...current, [name]: "" }));
        return;
      }
      const numericValue = Math.max(0, Math.min(10, Number(value)));
      setForm((current) => ({
        ...current,
        [name]: Number.isNaN(numericValue) ? "" : String(numericValue),
      }));
      return;
    }
    setForm((current) => ({ ...current, [name]: value }));
  };

  const upsertEntryForDate = (entryDate, entryPatch) => {
    const existing = data.find((item) => item.date === entryDate);
    const baseEntry = existing ? { ...existing } : buildStickyForm(data, { date: entryDate });
    const updated = data.some((item) => item.date === entryDate)
      ? data.map((item) => (item.date === entryDate ? { ...baseEntry, ...entryPatch, date: entryDate } : item))
      : [...data, { ...baseEntry, ...entryPatch, date: entryDate }];

    const sortedUpdated = enrichEntriesWithMedicationLevels(updated);
    const nextEntry = sortedUpdated.find((item) => item.date === entryDate) || { ...baseEntry, ...entryPatch, date: entryDate };
    persistData(sortedUpdated);
    return { sortedUpdated, nextEntry };
  };

  const populateFormForDate = (date, destinationPage = "metrics") => {
    const existing = data.find((entry) => entry.date === date);
    setActivePage(destinationPage);
    if (existing) {
      setForm({ ...buildStickyForm(data), ...existing });
      setEditingDate(date);
      setStatus(`Editing entry for ${date}.`);
      return;
    }
    setForm(buildStickyForm(data, { date }));
    setEditingDate(date);
    setStatus(`Creating a new entry for ${date}.`);
  };

  const saveDailyEntry = () => {
    const targetDate = editingDate || form.date;
    const { sortedUpdated, nextEntry } = upsertEntryForDate(targetDate, {
      weight: form.weight,
      calories: form.calories,
      protein: form.protein,
      fiber: form.fiber,
      fat: form.fat,
      nausea: form.nausea,
      foodNoise: form.foodNoise,
      hunger: form.hunger,
    });
    setStatus(`${editingDate ? "Updated" : "Saved"} daily entry for ${targetDate}.`);
    setForm(buildStickyForm(sortedUpdated, { ...nextEntry, date: targetDate }));
    setEditingDate(null);
  };

  const saveMedicationEntry = () => {
    if (!form.lastDose.trim()) {
      setMedicationError("Last dose time is required before saving a medication update.");
      setStatus("Medication update not saved.");
      return;
    }

    const medicationEntryDate = form.lastDose.slice(0, 10);
    const targetDate = medicationEntryDate || editingDate || form.date;
    const { sortedUpdated, nextEntry } = upsertEntryForDate(targetDate, {
      drug: form.drug,
      lastDose: form.lastDose,
      shotLocation: form.shotLocation,
      dosage: form.dosage,
    });
    setMedicationError("");
    setStatus(`Saved medication update for ${targetDate}.`);
    setForm(buildStickyForm(sortedUpdated, { ...nextEntry, date: getTodayDateString() }));
    setEditingDate(null);
  };

  const cancelEditing = () => {
    setEditingDate(null);
    setForm(buildStickyForm(data));
    setStatus("Edit canceled.");
  };

  const commitDataToFile = async () => {
    try {
      const result = await downloadJsonFile(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setStatus(
        result?.method === "share"
          ? `Prepared ${data.length} entr${data.length === 1 ? "y" : "ies"} for sharing from Files.`
          : `Committed ${data.length} entr${data.length === 1 ? "y" : "ies"} to a local JSON file.`
      );
    } catch {
      setStatus("Could not export your JSON file.");
    }
  };

  const refreshFromSavedData = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        setData([]);
        setStatus("No saved local data found.");
        return;
      }
      const parsed = sortEntries(normalizeLoadedData(JSON.parse(saved)));
      setData(parsed);
      setEditingDate(null);
      setForm(buildStickyForm(parsed));
      setStatus(`Loaded ${parsed.length} entr${parsed.length === 1 ? "y" : "ies"} from saved local data.`);
    } catch {
      setStatus("Could not read saved local data.");
    }
  };

  const openLoadDialog = async () => {
    setMenuOpen(false);
    if (IS_NATIVE_APP) {
      try {
        const selected = await pickJsonTextFromNativeFilePicker();
        if (!selected) return;
        applyImportedData(parseImportedEntries(selected.text), selected.name);
      } catch {
        setStatus("That file could not be loaded. Use a GLP-1 tracker JSON export.");
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const clearAllData = () => {
    setData([]);
    setEditingDate(null);
    setForm(buildStickyForm([]));
    localStorage.removeItem(STORAGE_KEY);
    setStatus("All data has been cleared.");
    setConfirmClearOpen(false);
    setMenuOpen(false);
  };

  const handleLoadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      applyImportedData(parseImportedEntries(text), file.name);
    } catch {
      setStatus("That file could not be loaded. Use a GLP-1 tracker JSON export.");
    } finally {
      event.target.value = "";
    }
  };

  const updateChartDateRange = (key, value) => {
    setChartDateRange((current) => ({ ...current, [key]: value }));
  };

  const clearChartDateRange = () => {
    setChartDateRange({ start: "", end: "" });
  };

  const renderDateRangeControls = () => (
    <div className="dateRangeControls">
      <div className="dateRangeGroup">
        <label>Start</label>
        <input
          type="date"
          className="dateRangeInput"
          value={chartDateRange.start}
          onChange={(e) => updateChartDateRange("start", e.target.value)}
        />
      </div>
      <div className="dateRangeGroup">
        <label>End</label>
        <input
          type="date"
          className="dateRangeInput"
          value={chartDateRange.end}
          onChange={(e) => updateChartDateRange("end", e.target.value)}
        />
      </div>
      <button type="button" className="dateRangeClearBtn" onClick={clearChartDateRange}>
        All Dates
      </button>
    </div>
  );

  const renderTrendViewer = () => {
    const medicationAxisDomain = [
      0,
      Number(Math.max(
        filteredChartData.reduce((max, entry) => {
          const value = getFiniteNumber(entry.medLevel);
          return value != null ? Math.max(max, value * 1.5) : max;
        }, 0),
        1
      ).toFixed(3)),
    ];

    const commonHeader = (
      <div>
        <h2>Trend Explorer</h2>
        <p className="subtle">Switch between the key comparison charts here. Click any point to open that day for editing.</p>
      </div>
    );
    const overlaySelect = (
      <select className="overlaySelect" value={selectedOverlayKey} onChange={(e) => setSelectedOverlayKey(e.target.value)}>
        {OVERLAY_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>{option.label}</option>
        ))}
      </select>
    );

    const renderChartShell = (headerContent, chart) => (
      <div className="card overlayCard fullWidthCard">
        <div className="chartHeader">
          {headerContent}
          {overlaySelect}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          {chart}
        </ResponsiveContainer>
      </div>
    );

    if (selectedOverlayKey === "medLevel") {
      return renderChartShell(
        <div>
          <h2>Trend Explorer</h2>
          <p className="subtle">
            Medication level extends to your selected end date and shows both the projected onboard level and the running average.
          </p>
          {renderDateRangeControls()}
          {medProjectionConfig.isCapped ? (
            <p className="subtle projectionNotice">
              Projection capped at {MAX_PROJECTION_DAYS} days past your latest entry for performance. Current cap ends on {medProjectionConfig.cappedEndDate}.
            </p>
          ) : null}
        </div>,
        <LineChart
          data={filteredProjectedMedLevelData}
          onClick={(state) => {
            const active = state?.activePayload?.[0]?.payload;
            if (active?.date && !active?.isProjection) populateFormForDate(active.date, "medication");
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={getPaddedYAxisDomain(filteredProjectedMedLevelData, ["projectedMedLevel", "projectedMedLevel_avg"])} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="projectedMedLevel" name="Projected Med Level" stroke={CHART_COLORS.medication} strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="projectedMedLevel_avg" name="Running Average" stroke={CHART_COLORS.purple} strokeDasharray="6 4" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      );
    }

    if (selectedOverlayKey === "weightVsMed") {
      return renderChartShell(
        commonHeader,
        <LineChart
          data={filteredWeightChartData}
          onClick={(state) => {
            const active = state?.activePayload?.[0]?.payload;
            if (active?.date) populateFormForDate(active.date, "metrics");
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" domain={getPaddedYAxisDomain(filteredWeightChartData, ["weight"])} />
          <YAxis yAxisId="right" orientation="right" domain={medicationAxisDomain} />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="medLevel"
            name="Medication Level"
            stroke={CHART_COLORS.medication}
            strokeDasharray="6 4"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 6 }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="weight"
            name="Weight"
            stroke={CHART_COLORS.purple}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 6 }}
            connectNulls
          />
        </LineChart>
      );
    }

    const subjectiveOverlay = SUBJECTIVE_OVERLAY_CONFIG[selectedOverlayKey];
    if (subjectiveOverlay) {
      return renderChartShell(
        commonHeader,
        <LineChart
          data={filteredChartData}
          onClick={(state) => {
            const active = state?.activePayload?.[0]?.payload;
            if (active?.date) populateFormForDate(active.date, "metrics");
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" domain={SUBJECTIVE_AXIS_DOMAIN} />
          <YAxis yAxisId="right" orientation="right" domain={medicationAxisDomain} />
          <Tooltip />
          <Legend />
          <Line yAxisId="right" type="monotone" dataKey="medLevel" name="Medication Level" stroke={CHART_COLORS.medication} strokeDasharray="6 4" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
          <Line yAxisId="left" type="monotone" dataKey={subjectiveOverlay.key} name={subjectiveOverlay.label} stroke={CHART_COLORS.purple} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        </LineChart>
      );
    }

    return renderChartShell(
      commonHeader,
      <LineChart
        data={filteredChartData}
        onClick={(state) => {
          const active = state?.activePayload?.[0]?.payload;
          if (active?.date) populateFormForDate(active.date, "metrics");
        }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis yAxisId="left" domain={getPaddedYAxisDomain(filteredChartData, ["calories"])} />
        <YAxis yAxisId="right" orientation="right" domain={getPaddedYAxisDomain(filteredChartData, ["protein", "fat", "fiber"])} />
        <Tooltip />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="calories" name="Calories" stroke={CHART_COLORS.medication} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        <Line yAxisId="right" type="monotone" dataKey="protein" name="Protein" stroke={CHART_COLORS.goldSoft} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        <Line yAxisId="right" type="monotone" dataKey="fat" name="Fat" stroke={CHART_COLORS.lavender} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
        <Line yAxisId="right" type="monotone" dataKey="fiber" name="Fiber" stroke={CHART_COLORS.purple} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
      </LineChart>
    );
  };

  const renderInsightsCard = () => (
    <div className="card summaryCard">
      <h2>Insights</h2>
      <p>Weight rate: {weightRate.toFixed(2)} lbs/week</p>
      <p>Est deficit: {estimatedDeficit.toFixed(0)} kcal/day</p>
      <p>Next dose: {nextDoseText}</p>
      <p className="status">{status}</p>
    </div>
  );

  const renderMedicationPage = () => (
    <div className="pageStack">
      <div className="section medicationSection">
        <div className="sectionTitleRow">
          <h2 className="sectionTitle">Medication Update</h2>
        </div>
        <p className="subtle sectionHint">Use this when your GLP-1 shot details change, usually about once a week.</p>

        <div className="sectionGrid medicationGrid">
          <Field label="Medication Type" desc="Select your GLP-1 medication" compact>
            <select name="drug" value={form.drug} onChange={handleChange} className="input">
              {Object.keys(DRUGS).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>

          <Field label="Last Dose Time" desc="When you last injected" compact>
            <input
              type="datetime-local"
              name="lastDose"
              value={form.lastDose}
              onChange={handleChange}
              className={`input ${medicationError ? "inputError" : ""}`}
              aria-invalid={Boolean(medicationError)}
            />
          </Field>

          <Field label="Injection Site" desc="Where the shot was administered" compact>
            <select name="shotLocation" value={form.shotLocation} onChange={handleChange} className="input">
              <option>Left thigh</option>
              <option>Right thigh</option>
              <option>Abdomen</option>
            </select>
          </Field>

          <Field label="Dosage" desc="Amount taken (mg)" compact>
            <input name="dosage" placeholder="Dosage (mg)" value={form.dosage} onChange={handleChange} className="input" />
          </Field>
        </div>
        {medicationError ? <p className="formError">{medicationError}</p> : null}
        <button type="button" className="btn secondaryActionBtn" onClick={saveMedicationEntry}>
          Save Medication Update
        </button>
      </div>

      {renderInsightsCard()}
    </div>
  );

  const renderMetricsPage = () => (
    <div className="pageStack">
      <div className="section">
        <div className="sectionTitleRow">
          <h2 className="sectionTitle">Daily Entry</h2>
        </div>
        <p className="subtle sectionHint">Choose the date and log your current body metrics for that day.</p>

        <div className="sectionGrid">
          <Field label="Date" desc="Entry date" compact>
            <input type="date" name="date" value={form.date} onChange={handleChange} className="input" />
          </Field>

          <Field label="Weight" desc="Body weight (lbs)" compact>
            <input name="weight" value={form.weight} onChange={handleChange} className="input" />
          </Field>
        </div>
      </div>

      <div className="section">
        <div className="sectionTitleRow">
          <h2 className="sectionTitle">Nutrition</h2>
        </div>
        <p className="subtle sectionHint">Track the main nutrition totals that support your daily trends.</p>

        <div className="sectionGrid">
          <Field label="Calories" desc="Daily calorie intake" compact>
            <input name="calories" value={form.calories} onChange={handleChange} className="input" />
          </Field>
          <Field label="Protein" desc="Daily protein intake (g)" compact>
            <input name="protein" value={form.protein} onChange={handleChange} className="input" />
          </Field>
          <Field label="Fiber" desc="Daily fiber intake (g)" compact>
            <input name="fiber" value={form.fiber} onChange={handleChange} className="input" />
          </Field>
          <Field label="Fat" desc="Daily fat intake (g)" compact>
            <input name="fat" value={form.fat} onChange={handleChange} className="input" />
          </Field>
        </div>
      </div>

      <div className="section">
        <div className="sectionTitleRow">
          <h2 className="sectionTitle">Subjective Metrics</h2>
        </div>
        <p className="subtle sectionHint">Capture how the day felt using the 0-10 symptom and hunger scales.</p>

        <div className="sectionGrid">
          <Field label="Nausea" desc="0 (none) → 10 (maximum)">
            <DotScale name="nausea" value={form.nausea} onChange={handleChange} />
          </Field>
          <Field label="Food Noise" desc="Mental food focus (0 = none, 10 = maximum)">
            <DotScale name="foodNoise" value={form.foodNoise} onChange={handleChange} />
          </Field>
          <Field label="Hunger" desc="Physical hunger (0 = none, 10 = maximum)">
            <DotScale name="hunger" value={form.hunger} onChange={handleChange} />
          </Field>
        </div>
      </div>

      <div className="actionBar">
        <button onClick={saveDailyEntry} className="btn primaryBtn">
          {editingDate ? "Update Daily Entry" : "Add Daily Entry"}
        </button>
      </div>

      {renderInsightsCard()}
    </div>
  );

  const renderChartsPage = () => (
    <div className="pageStack">
      <CalendarHeatmap
        cells={calendarCells}
        dark={dark}
        onSelectDate={(date) => populateFormForDate(date, "metrics")}
        selectedDate={editingDate || form.date}
        offsetDays={heatmapOffsetDays}
        onOffsetChange={setHeatmapOffsetDays}
      />
      {renderTrendViewer()}
    </div>
  );

  return (
    <div className={dark ? "app dark" : "app"}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleLoadFile}
        style={{ display: "none" }}
      />

      <div className="shell">
        <div className="topBar">
          <div className="menuWrap" ref={menuRef}>
            <button
              type="button"
              className="iconBtn"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Open actions menu"
              aria-expanded={menuOpen}
            >
              <span />
              <span />
              <span />
            </button>
            {menuOpen ? (
              <div className="menuPanel">
                <div className="menuSection">
                  <p className="menuLabel">Pages</p>
                  {PAGE_OPTIONS.map((page) => (
                    <button
                      key={page.key}
                      type="button"
                      onClick={() => navigateToPage(page.key)}
                      className={`menuItem ${activePage === page.key ? "menuItemActive" : ""}`}
                    >
                      {page.label}
                    </button>
                  ))}
                </div>
                <div className="menuDivider" />
                <div className="menuSection">
                  <p className="menuLabel">Actions</p>
                  <button onClick={() => { void commitDataToFile(); setMenuOpen(false); }} className="menuItem">Commit Data to File</button>
                  <button onClick={openLoadDialog} className="menuItem">Load Data File</button>
                  <button onClick={() => { refreshFromSavedData(); setMenuOpen(false); }} className="menuItem">Refresh Saved Data</button>
                  <button onClick={() => { void exportCSV(data); setMenuOpen(false); }} className="menuItem">Export CSV</button>
                  <button onClick={() => { setDark(!dark); setMenuOpen(false); }} className="menuItem">{dark ? "Light Mode" : "Dark Mode"}</button>
                  <button onClick={() => { setConfirmClearOpen(true); setMenuOpen(false); }} className="menuItem dangerItem">Clear All Data</button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="titleBlock">
            <h1>GLP-1 Tracker</h1>
            <p className="subtle pageBlurb">{activePageMeta.blurb}</p>
          </div>
        </div>

        <div className="pageTabs">
          {PAGE_OPTIONS.map((page) => (
            <button
              key={page.key}
              type="button"
              className={`pageTab ${activePage === page.key ? "pageTabActive" : ""}`}
              onClick={() => navigateToPage(page.key)}
            >
              {page.label}
            </button>
          ))}
        </div>

        {editingDate ? (
          <div className="editingBanner">
            <div>
              <strong>Editing {editingDate}</strong>
              <p>Changes will overwrite that day’s entry.</p>
            </div>
            <button type="button" className="smallBtn" onClick={cancelEditing}>
              Cancel
            </button>
          </div>
        ) : null}

        <div className="contentCard">
          {activePage === "medication" ? renderMedicationPage() : null}
          {activePage === "metrics" ? renderMetricsPage() : null}
          {activePage === "charts" ? renderChartsPage() : null}
        </div>
      </div>

      {confirmClearOpen ? (
        <div className="dialogOverlay" onClick={() => setConfirmClearOpen(false)}>
          <div className="dialogCard" onClick={(e) => e.stopPropagation()}>
            <h2>Clear all data?</h2>
            <p>
              This will permanently remove all tracker entries currently stored in the app.
              This action cannot be undone unless you have a saved JSON file backup.
            </p>
            <div className="dialogActions">
              <button className="dialogBtn secondaryDialogBtn" onClick={() => setConfirmClearOpen(false)}>
                Cancel
              </button>
              <button className="dialogBtn dangerDialogBtn" onClick={clearAllData}>
                Yes, Clear Data
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        :root {
          --app-edge-padding: clamp(10px, 2vw, 18px);
        }
        html, body, #root {
          margin:0;
          min-height:100%;
          width:100%;
        }
        body {
          background:#07111f;
        }
        * {
          box-sizing:border-box;
        }
        .app {
          min-height:100vh;
          min-height:100dvh;
          width:100%;
          font-family:sans-serif;
          padding-top:calc(env(safe-area-inset-top, 0px) + var(--app-edge-padding));
          padding-right:var(--app-edge-padding);
          padding-bottom:var(--app-edge-padding);
          padding-left:var(--app-edge-padding);
        }
        .dark { background:#07111f; color:#f8fafc; }
        .shell {
          width:min(100%, 520px);
          margin:0 auto;
          display:flex;
          flex-direction:column;
          gap:12px;
        }
        .topBar {
          display:flex;
          align-items:flex-start;
          gap:12px;
        }
        .titleBlock {
          min-width:0;
          flex:1;
          padding-top:2px;
        }
        .titleBlock h1 {
          margin:0;
          font-size:clamp(1.5rem, 5vw, 1.9rem);
        }
        .pageBlurb {
          margin-top:6px;
        }
        .pageTabs {
          display:flex;
          gap:8px;
          overflow-x:auto;
          padding-bottom:2px;
        }
        .pageTab {
          border:none;
          border-radius:999px;
          padding:10px 14px;
          background:#1b2a40;
          color:#cbd5e1;
          white-space:nowrap;
          cursor:pointer;
          font-weight:600;
        }
        .pageTabActive {
          background:#8b5cf6;
          color:#f8fafc;
        }
        .contentCard {
          background:rgba(15, 27, 45, 0.9);
          border:1px solid #1f2f49;
          border-radius:20px;
          padding:clamp(12px, 3vw, 16px);
          box-shadow:0 18px 36px rgba(2, 6, 23, 0.28);
        }
        .pageStack {
          display:flex;
          flex-direction:column;
          gap:12px;
        }

        .section { border-bottom:1px solid #ddd; padding-bottom:10px; margin-bottom:10px; }
        .medicationSection {
          border-bottom:1px solid #ddd;
          padding-bottom:10px;
          margin-bottom:10px;
        }
        .sectionHint {
          margin-top:6px;
          margin-bottom:10px;
        }
        .sectionTitleRow {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          margin-bottom:6px;
        }
        .sectionTitle {
          margin:0;
          font-size:1rem;
          font-weight:700;
          color:inherit;
        }
        .medicationToggle {
          width:100%;
          display:flex;
          align-items:center;
          justify-content:space-between;
          border:none;
          border-radius:10px;
          padding:12px 14px;
          background:#ede9fe;
          color:#5b21b6;
          font-weight:700;
          cursor:pointer;
        }
        .toggleChevron {
          transition:transform 0.2s ease;
        }
        .toggleChevronOpen {
          transform:rotate(180deg);
        }
        .medicationGrid {
          margin-top:8px;
          margin-bottom:10px;
        }
        .section h3 { margin-bottom:6px; }
        .sectionGrid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:14px 24px; }
        .sectionStack { display:flex; flex-direction:column; gap:10px; }
        .field { min-width:0; }
        .fieldCompact { align-self:start; }
        .field label { font-weight:bold; display:block; }
        .field small { opacity:0.7; display:block; margin-bottom:4px; }

        .input {
          width:100%;
          margin-top:4px;
          padding:8px;
          border-radius:6px;
          background:#f3f4f6;
          border:1px solid #ccc;
          box-sizing:border-box;
        }
        .inputError { border-color:#dc2626; }
        .formError { margin:0 0 6px 0; color:#b91c1c; font-size:0.9rem; }

        .dotScaleWrap { margin-top:6px; }
        .dotScale { display:grid; grid-template-columns:repeat(11, minmax(0, 1fr)); gap:6px; }
        .dotButton {
          border:none;
          border-radius:999px;
          aspect-ratio:1 / 1;
          min-width:0;
          background:#d1d5db;
          color:#374151;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:0.72rem;
          font-weight:600;
          padding:0;
        }
        .dotButtonActive {
          background:#7c3aed;
          color:white;
          box-shadow:0 0 0 2px rgba(124,58,237,0.18);
        }

        .editingBanner {
          display:flex;
          justify-content:space-between;
          gap:10px;
          align-items:flex-start;
          margin-bottom:12px;
          padding:10px;
          border-radius:10px;
          background:#ede9fe;
          color:#5b21b6;
        }
        .editingBanner p { margin:4px 0 0 0; font-size:0.9rem; }
        .smallBtn {
          border:none;
          border-radius:8px;
          background:#7c3aed;
          color:white;
          padding:8px 10px;
          cursor:pointer;
        }

        .actionBar { display:flex; gap:8px; margin-top:8px; align-items:flex-start; }
        .btn {
          width:100%;
          margin-top:5px;
          padding:8px;
          border:none;
          border-radius:6px;
          background:#7c3aed;
          color:white;
          cursor:pointer;
        }
        .primaryBtn { margin-top:0; flex:1; }
        .secondaryActionBtn {
          background:#5b21b6;
          margin-top:2px;
        }

        .menuWrap { position:relative; }
        .iconBtn {
          width:42px;
          height:42px;
          border:none;
          border-radius:10px;
          background:#7c3aed;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
          gap:4px;
          cursor:pointer;
          padding:0;
        }
        .iconBtn span {
          display:block;
          width:18px;
          height:2px;
          background:white;
          border-radius:999px;
        }
        .menuPanel {
          position:absolute;
          top:48px;
          left:0;
          min-width:240px;
          background:white;
          border:1px solid #d1d5db;
          border-radius:10px;
          box-shadow:0 10px 24px rgba(0,0,0,0.12);
          padding:6px;
          z-index:20;
        }
        .menuSection {
          display:flex;
          flex-direction:column;
          gap:2px;
        }
        .menuLabel {
          margin:4px 10px 6px;
          font-size:0.76rem;
          font-weight:700;
          letter-spacing:0.04em;
          text-transform:uppercase;
          opacity:0.65;
        }
        .menuDivider {
          height:1px;
          background:#e5e7eb;
          margin:6px 4px;
        }
        .menuItem {
          width:100%;
          text-align:left;
          background:transparent;
          border:none;
          border-radius:8px;
          padding:10px 12px;
          cursor:pointer;
        }
        .menuItem:hover { background:#f3f4f6; }
        .menuItemActive {
          background:#ede9fe;
          color:#5b21b6;
          font-weight:700;
        }
        .dangerItem { color:#b91c1c; }

        .card { background:white; padding:clamp(10px, 1.6vw, 14px); border-radius:10px; min-height:120px; min-width:0; }
        .compactCard { padding:8px; min-height:auto; }
        .overlayCard { min-height:360px; }
        .fullWidthCard { grid-column:1 / -1; }
        .summaryCard { min-height:auto; }

        .chartHeader,
        .cardHeaderRow {
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:10px;
          margin-bottom:8px;
        }
        .compactHeaderRow {
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:10px;
          margin-bottom:8px;
        }
        .subtle { margin:4px 0 0 0; opacity:0.72; font-size:0.92rem; }
        .compactCard h2 { font-size:1rem; margin:0; }
        .compactCard .subtle { font-size:0.8rem; }
        .status { margin-top:8px; font-size:0.92rem; }
        .overlaySelect,
        .dateRangeInput {
          min-width:190px;
          padding:8px 10px;
          border-radius:8px;
          border:1px solid #d1d5db;
          background:#f8fafc;
        }
        .dateRangeControls { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:end; }
        .dateRangeGroup { display:flex; flex-direction:column; gap:4px; }
        .dateRangeGroup label { font-size:0.78rem; opacity:0.75; }
        .dateRangeClearBtn {
          border:none;
          border-radius:8px;
          padding:8px 12px;
          background:#e5e7eb;
          cursor:pointer;
        }
        .projectionNotice { margin-top:8px; color:#b45309; }

        .heatmapScrollerHeader {
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          margin-bottom:6px;
        }
        .heatmapTodayBtn {
          border:none;
          border-radius:8px;
          padding:6px 10px;
          background:#ede9fe;
          color:#6d28d9;
          cursor:pointer;
          font-weight:600;
        }
        .heatmapGrid { display:grid; grid-template-columns:repeat(auto-fit, minmax(64px, 1fr)); gap:6px; margin-top:8px; }
        .weeklyHeatmapGrid { grid-template-columns:repeat(7, minmax(0, 1fr)); gap:4px; margin-top:6px; }
        .heatCell {
          border:none;
          min-height:42px;
          border-radius:8px;
          cursor:pointer;
          color:#111827;
          font-weight:600;
          padding:0;
        }
        .compactHeatCell {
          min-height:52px;
          padding:6px 4px;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          gap:2px;
          font-size:0.78rem;
        }
        .heatCellWeekday { font-size:0.7rem; opacity:0.85; }
        .heatCellDay { font-size:0.95rem; font-weight:700; }
        .selectedHeatCell { outline:3px solid #111827; outline-offset:1px; }
        .heatmapScroller { margin-top:8px; }
        .heatmapScrollerMeta { display:flex; justify-content:space-between; gap:10px; margin-bottom:4px; }
        .heatmapRange { width:100%; accent-color:#2563eb; }

        .dialogOverlay {
          position:fixed;
          inset:0;
          background:rgba(0,0,0,0.45);
          display:flex;
          align-items:center;
          justify-content:center;
          z-index:50;
          padding:16px;
        }
        .dialogCard {
          width:min(100%, 420px);
          background:white;
          border-radius:14px;
          padding:18px;
          box-shadow:0 18px 50px rgba(0,0,0,0.2);
        }
        .dialogCard h2 { margin:0 0 8px 0; }
        .dialogCard p { margin:0; line-height:1.5; }
        .dialogActions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
        .dialogBtn {
          border:none;
          border-radius:8px;
          padding:10px 14px;
          cursor:pointer;
        }
        .secondaryDialogBtn { background:#e5e7eb; color:#111827; }
        .dangerDialogBtn { background:#dc2626; color:white; }

        .dark .card {
          background:#0f1b2d;
          border:1px solid #1f2f49;
          box-shadow:0 10px 24px rgba(2, 6, 23, 0.28);
        }
        .dark .input { background:#13233a; color:#f8fafc; border-color:#2b3d5b; }
        .dark .inputError { border-color:#fca5a5; }
        .dark .formError { color:#fca5a5; }
        .dark .medicationToggle {
          background:#24123f;
          color:#ede9fe;
          border:1px solid #6d28d9;
        }
        .dark .dotButton { background:#1f2f49; color:#e2e8f0; }
        .dark .dotButtonActive {
          background:#8b5cf6;
          color:#f8fafc;
          box-shadow:0 0 0 2px rgba(139,92,246,0.24);
        }
        .dark .overlaySelect,
        .dark .dateRangeInput { background:#13233a; color:#f8fafc; border-color:#2b3d5b; }
        .dark .dateRangeClearBtn { background:#2a3650; color:#f8fafc; }
        .dark .menuPanel { background:#0f1b2d; border-color:#2b3d5b; }
        .dark .menuItem { color:white; }
        .dark .menuItem:hover { background:#1a2a44; }
        .dark .menuItemActive { background:#24123f; color:#ede9fe; }
        .dark .dangerItem { color:#fda4af; }
        .dark .menuDivider { background:#24324a; }
        .dark .pageTab { background:#13233a; color:#cbd5e1; }
        .dark .pageTabActive { background:#8b5cf6; color:#f8fafc; }
        .dark .dialogCard { background:#0f1b2d; color:#f8fafc; border:1px solid #2b3d5b; }
        .dark .secondaryDialogBtn { background:#24324a; color:#f8fafc; }
        .dark .editingBanner { background:#24123f; color:#ede9fe; border:1px solid #6d28d9; }
        .dark .smallBtn { background:#8b5cf6; color:#f8fafc; }
        .dark .heatmapTodayBtn { background:#8b5cf6; color:#f8fafc; }
        .dark .heatCell { color:white; }
        .dark .selectedHeatCell { outline-color:#f59e0b; }
        .dark .projectionNotice { color:#fbbf24; }
        .dark .heatmapRange { accent-color:#8b5cf6; }

        @media (max-width: 1100px) {
          .app { --app-edge-padding:12px; }
          .fullWidthCard { grid-column:auto; }
          .weeklyHeatmapGrid { grid-template-columns:repeat(7, minmax(0, 1fr)); }
          .sectionGrid { grid-template-columns:1fr; }
        }
        @media (max-width: 700px) {
          .app { --app-edge-padding:10px; }
          .contentCard { padding:12px; }
          .actionBar { flex-direction:column; }
          .topBar { align-items:center; }
          .heatCell { min-height:36px; }
          .compactHeatCell { min-height:48px; font-size:0.72rem; }
          .chartHeader,
          .cardHeaderRow {
            flex-direction:column;
          }
          .overlaySelect,
          .dateRangeInput {
            min-width:0;
            width:100%;
          }
        }
      `}</style>
    </div>
  );
}
