/**
 * Display names, spoken cues and highlight joints for the REHAB26 mistake labels.
 * English cue text ships inside each model JSON (model.cues / model.short); Spanish lives here.
 */

export const REHAB_EXERCISES = ["squat", "arm_abduction", "shoulder_extension"];

export const EXERCISE_TITLES = {
  en: { squat: "Bodyweight Squat", arm_abduction: "Shoulder Abduction", shoulder_extension: "Shoulder Extension" },
  es: { squat: "Sentadilla", arm_abduction: "Abducción de hombro", shoulder_extension: "Extensión de hombro" },
};

export const HOWTO = {
  en: {
    squat: "Face the camera with your whole body, head to feet, in frame. Hold still until it says Go, then squat down and stand all the way back up for each rep.",
    arm_abduction: "Face the camera with your whole body in frame and your right arm by your side. After Go, raise your right arm out to the side and bring it all the way back down for each rep.",
    shoulder_extension: "Face the camera with your whole body in frame and your right arm by your side. After Go, each time you hear \"Back\", move your right arm straight back behind you and return before the next cue.",
  },
  es: {
    squat: "Ponte de frente a la cámara con todo el cuerpo, de la cabeza a los pies, en el cuadro. Quédate quieto hasta que diga Ya, luego baja en sentadilla y sube por completo en cada repetición.",
    arm_abduction: "Ponte de frente a la cámara con todo el cuerpo en el cuadro y el brazo derecho a tu lado. Después de Ya, sube el brazo derecho hacia el costado y bájalo por completo en cada repetición.",
    shoulder_extension: "Ponte de frente a la cámara con todo el cuerpo en el cuadro y el brazo derecho a tu lado. Después de Ya, cada vez que oigas \"Atrás\", lleva el brazo derecho recto hacia atrás y regresa antes de la siguiente señal.",
  },
};

export const LABELS = {
  en: {
    CORRECT: "Good form",
    ERR_KNEES_INSIDE: "Knees caving in", ERR_TORSO_TO_SIDE: "Leaning to one side", ERR_SHALLOW_SQUAT: "Not deep enough",
    ERR_KNEES_FORWARD: "Knees past toes", ERR_LIFTED_HEELS: "Heels lifting",
    ERR_ARM_FORWARD: "Arm drifting forward", ERR_ELEVATED_SHOULDER: "Shoulder shrugging", ERR_HEAD_TO_SIDE: "Head tilting",
    ERR_LOW_ABDUCTION: "Arm not high enough", ERR_BENT_ARM: "Elbow bending",
    ERR_TORSO_FORWARD: "Leaning forward", ERR_TORSO_ROTATION: "Torso twisting", ERR_ARM_TO_SIDE: "Arm drifting out",
  },
  es: {
    CORRECT: "Buena forma",
    ERR_KNEES_INSIDE: "Rodillas hacia adentro", ERR_TORSO_TO_SIDE: "Inclinado a un lado", ERR_SHALLOW_SQUAT: "Poca profundidad",
    ERR_KNEES_FORWARD: "Rodillas pasan los pies", ERR_LIFTED_HEELS: "Talones levantados",
    ERR_ARM_FORWARD: "Brazo hacia adelante", ERR_ELEVATED_SHOULDER: "Hombro encogido", ERR_HEAD_TO_SIDE: "Cabeza inclinada",
    ERR_LOW_ABDUCTION: "Brazo muy bajo", ERR_BENT_ARM: "Codo doblado",
    ERR_TORSO_FORWARD: "Inclinado hacia adelante", ERR_TORSO_ROTATION: "Torso girado", ERR_ARM_TO_SIDE: "Brazo hacia afuera",
  },
};

const CUES_ES = {
  CORRECT: "Buena repetición.",
  ERR_ARM_FORWARD: "Sube el brazo hacia el costado, alineado con el cuerpo, no al frente.",
  ERR_ELEVATED_SHOULDER: "Mantén el hombro abajo; no lo encojas.",
  ERR_HEAD_TO_SIDE: "Mantén la cabeza recta; no la inclines.",
  ERR_LOW_ABDUCTION: "Sube más el brazo, al menos a la altura del hombro.",
  ERR_BENT_ARM: "Mantén el codo recto.",
  ERR_KNEES_INSIDE: "Empuja las rodillas hacia afuera, alineadas con los pies.",
  ERR_TORSO_TO_SIDE: "Mantén el torso centrado; no te inclines a un lado.",
  ERR_SHALLOW_SQUAT: "Baja más: siéntate hacia atrás hasta que los muslos estén casi paralelos.",
  ERR_KNEES_FORWARD: "Lleva la cadera atrás para que las rodillas no pasen los pies.",
  ERR_LIFTED_HEELS: "Mantén los talones en el suelo.",
  ERR_TORSO_FORWARD: "Mantén el torso erguido; no te inclines hacia adelante.",
  ERR_TORSO_ROTATION: "Mantén el pecho al frente; no gires.",
  ERR_ARM_TO_SIDE: "Lleva el brazo recto hacia atrás, cerca del cuerpo.",
};

const SHORT_ES = {
  CORRECT: "Bien", ERR_ARM_FORWARD: "Brazo al costado", ERR_ELEVATED_SHOULDER: "Hombro abajo",
  ERR_HEAD_TO_SIDE: "Cabeza recta", ERR_LOW_ABDUCTION: "Más alto", ERR_BENT_ARM: "Codo recto",
  ERR_KNEES_INSIDE: "Rodillas afuera", ERR_TORSO_TO_SIDE: "Centrado", ERR_SHALLOW_SQUAT: "Más abajo",
  ERR_KNEES_FORWARD: "Cadera atrás", ERR_LIFTED_HEELS: "Talones abajo", ERR_TORSO_FORWARD: "Pecho arriba",
  ERR_TORSO_ROTATION: "No gires", ERR_ARM_TO_SIDE: "Brazo recto atrás",
};

// Joint names understood by SkeletonOverlay.drawSkeleton
export const HIGHLIGHT = {
  ERR_KNEES_INSIDE: ["left_knee", "right_knee"],
  ERR_KNEES_FORWARD: ["left_knee", "right_knee"],
  ERR_SHALLOW_SQUAT: ["left_hip", "right_hip", "left_knee", "right_knee"],
  ERR_LIFTED_HEELS: ["left_ankle", "right_ankle", "left_foot", "right_foot"],
  ERR_TORSO_TO_SIDE: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  ERR_TORSO_FORWARD: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  ERR_TORSO_ROTATION: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  ERR_ARM_FORWARD: ["right_shoulder", "right_elbow", "right_wrist"],
  ERR_ARM_TO_SIDE: ["right_shoulder", "right_elbow", "right_wrist"],
  ERR_LOW_ABDUCTION: ["right_shoulder", "right_elbow", "right_wrist"],
  ERR_BENT_ARM: ["right_elbow"],
  ERR_ELEVATED_SHOULDER: ["right_shoulder", "left_shoulder"],
  ERR_HEAD_TO_SIDE: ["nose"],
};

export function labelName(code, language = "en") {
  return LABELS[language]?.[code] || LABELS.en[code] || code.replace(/^ERR_/, "").toLowerCase().replace(/_/g, " ");
}

export function cueText(model, code, language = "en") {
  return language === "es" ? CUES_ES[code] || model.cues[code] : model.cues[code];
}

export function shortText(model, code, language = "en") {
  return language === "es" ? SHORT_ES[code] || model.short[code] : model.short[code];
}

export function tempoCue(model, language = "en") {
  return language === "es" ? "Atrás" : model.segmenter.cue;
}

// Setup-gate and rep-validation messages come from session.js in English; translate for the ES toggle.
const MESSAGES_ES = {
  "Show your whole body": "Muestra todo tu cuerpo",
  "Face the camera": "Ponte de frente a la cámara",
  "Turn so your chest faces the screen.": "Gira para que tu pecho mire a la pantalla.",
  "Get into the start position": "Ponte en la posición inicial",
  "Stand tall with your feet hip-width apart.": "Párate derecho con los pies al ancho de la cadera.",
  "Let your right arm hang by your side.": "Deja el brazo derecho colgando a tu lado.",
  "Hold still": "Quédate quieto",
  "Getting your start position…": "Registrando tu posición inicial…",
  "Keep your whole body in the frame during the rep": "Mantén todo el cuerpo en el cuadro durante la repetición",
  "Too quick to count: move slowly and with control": "Muy rápido para contar: muévete despacio y con control",
  "That took too long to count as one rep": "Tardó demasiado para contar como una repetición",
  "Stay in one spot while you do the rep": "Quédate en un lugar durante la repetición",
  "Too shallow to count: sit down and back further": "Muy poco profunda: siéntate más abajo y atrás",
  "Raise your arm higher for it to count": "Sube más el brazo para que cuente",
  "Finish the rep: return to the start position": "Termina la repetición: vuelve a la posición inicial",
  "Use only your right arm": "Usa solo el brazo derecho",
  "Out of frame": "Fuera del cuadro", "Too fast": "Muy rápido", "Too slow": "Muy lento",
  "Moved position": "Te moviste", "Not deep enough": "Poca profundidad", "Not high enough": "Poco alto",
  "Incomplete rep": "Repetición incompleta", "Wrong arm": "Brazo equivocado",
};
const PARTS_ES = { head: "cabeza", shoulders: "hombros", elbows: "codos", hands: "manos", hips: "caderas", knees: "rodillas", feet: "pies" };

export function translateMessage(text, language = "en") {
  if (language !== "es" || !text) return text;
  const m = /^Step back until the camera sees your (.+)\.$/.exec(text);
  if (m) return `Aléjate hasta que la cámara vea tus ${m[1].split(", ").map((p) => PARTS_ES[p] || p).join(", ")}.`;
  return MESSAGES_ES[text] || text;
}
