import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const capacitorConfigPath = path.join(root, "capacitor.config.json");
const projectPath = path.join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
const infoPlistPath = path.join(root, "ios", "App", "App", "Info.plist");
const appIconPath = path.join(root, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "Contents.json");
const activeAppPath = path.join(root, "src", "App.jsx");
const builtWebPath = path.join(root, "dist");
const iosPublicPath = path.join(root, "ios", "App", "App", "public");

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function findFirstMatch(text, regex) {
  const match = text.match(regex);
  return match?.[1] ?? null;
}

function collectTextFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return collectTextFiles(fullPath);
    if (!/\.(html|js|json|txt|css|map)$/i.test(entry.name)) return [];
    return [readText(fullPath)];
  });
}

function collectWarnings() {
  const warnings = [];

  const capacitorConfigText = readText(capacitorConfigPath);
  const projectText = readText(projectPath);
  const infoPlistText = readText(infoPlistPath);
  const activeAppText = readText(activeAppPath);

  if (!capacitorConfigText) {
    warnings.push("Missing capacitor.config.json");
    return warnings;
  }

  const capacitorConfig = JSON.parse(capacitorConfigText);
  const bundleId = capacitorConfig.appId || "unknown";
  const appName = capacitorConfig.appName || "unknown";
  const webDir = capacitorConfig.webDir || "unknown";
  const marketingVersion = findFirstMatch(projectText, /MARKETING_VERSION = ([^;]+);/);
  const buildNumber = findFirstMatch(projectText, /CURRENT_PROJECT_VERSION = ([^;]+);/);
  const targetedDeviceFamily = findFirstMatch(projectText, /TARGETED_DEVICE_FAMILY = ([^;]+);/);

  const iphoneOrientationBlock = findFirstMatch(
    infoPlistText,
    /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/
  );
  const iphoneOrientationCount = (iphoneOrientationBlock?.match(/UIInterfaceOrientation/g) || []).length;
  const distributedWebText = [activeAppText, ...collectTextFiles(builtWebPath), ...collectTextFiles(iosPublicPath)].join("\n");

  if (bundleId === "com.example.app") {
    warnings.push("Bundle ID still looks like a placeholder. Choose the final App Store bundle ID before creating the App Store Connect record.");
  }

  if (!marketingVersion || !buildNumber) {
    warnings.push("Could not read MARKETING_VERSION and CURRENT_PROJECT_VERSION from the iOS project.");
  }

  if (iphoneOrientationCount !== 1 || !iphoneOrientationBlock?.includes("UIInterfaceOrientationPortrait")) {
    warnings.push("iPhone orientations are not portrait-only. This project is designed as a vertical iPhone app.");
  }

  if (targetedDeviceFamily && targetedDeviceFamily.replace(/"/g, "").trim() !== "1") {
    warnings.push("Targeted device family still includes iPad. The current release plan says this should ship as an iPhone-only app.");
  }

  if (!fs.existsSync(appIconPath)) {
    warnings.push("App icon asset catalog is missing.");
  }

  if (/localhost|127\.0\.0\.1/.test(distributedWebText)) {
    warnings.push("App code or built web assets still reference localhost. That will not work for an App Store build on user devices.");
  }

  const summary = [
    `App name: ${appName}`,
    `Bundle ID: ${bundleId}`,
    `Web dir: ${webDir}`,
    `Marketing version: ${marketingVersion || "unknown"}`,
    `Build number: ${buildNumber || "unknown"}`,
  ];

  return { warnings, summary };
}

const { warnings, summary } = collectWarnings();

console.log("iOS App Store preflight");
console.log("=======================");
summary.forEach((line) => console.log(line));

if (!warnings.length) {
  console.log("\nNo preflight warnings found.");
} else {
  console.log("\nWarnings:");
  warnings.forEach((warning, index) => {
    console.log(`${index + 1}. ${warning}`);
  });
}

console.log("\nNext steps:");
console.log("1. Run `npm run ios:open` and set Signing & Capabilities in Xcode.");
console.log("2. Create the matching app record in App Store Connect before your first upload.");
console.log("3. Archive from Xcode and upload with Organizer for TestFlight/App Store.");
