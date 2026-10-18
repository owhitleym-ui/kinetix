// Exercise library: body regions -> exercises, with what each one targets and why it's prescribed.
// `soon: true` = shown as "Coming soon" (planned, not available yet). Everything else has a model in models/.

const S = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const DASH = 'stroke-dasharray="2 3.5" stroke-width="2"';
const fig = (body) => `<svg viewBox="0 0 56 56" ${S} stroke-width="2.6" aria-hidden="true">${body}</svg>`;
const STAND = '<circle cx="25" cy="10" r="4.5"/><path d="M25 16 V32"/><path d="M25 32 L20 47"/><path d="M25 32 L30 47"/><path d="M25 19 L19 30"/>';

// Region artwork (anatomical line drawings)
const REGION_ART = {
  shoulder: `<svg viewBox="0 0 64 64" ${S} stroke-width="2.2" aria-hidden="true">
    <circle cx="25" cy="12" r="5.5"/><path d="M25 17.5 V21"/><path d="M25 21 Q19 21 14 24"/><path d="M25 21 Q32 21 38 24"/>
    <path d="M15.5 25 L17.5 50"/><path d="M36.5 25 L34.5 50"/><path d="M14 24 L11 42 L12 50"/>
    <path d="M38 24 L57 13"/><circle cx="38" cy="24" r="4.4" fill="currentColor" fill-opacity=".16"/>
    <path d="M43 39 A 17 17 0 0 0 56 22" ${DASH}/><path d="M53.5 23.5 L56.5 21 L58.5 24.5" stroke-width="2"/></svg>`,
  spine: `<svg viewBox="0 0 64 64" ${S} stroke-width="2.2" aria-hidden="true">
    <rect x="27" y="5" width="10" height="5" rx="2"/><rect x="26" y="12" width="12" height="5.5" rx="2"/>
    <rect x="25.5" y="19.5" width="13" height="6" rx="2.2"/><rect x="26" y="27.5" width="13" height="6" rx="2.2"/>
    <rect x="27" y="35.5" width="13" height="6.5" rx="2.4" fill="currentColor" fill-opacity=".16"/>
    <rect x="27.5" y="44" width="12" height="5" rx="2"/><path d="M17 52 Q33 46 49 52 L44 60 H22 Z"/></svg>`,
  lower: `<svg viewBox="0 0 64 64" ${S} stroke-width="2.2" aria-hidden="true">
    <path d="M13 9 Q32 3 51 9 L47 18 Q32 14 17 18 Z"/>
    <path d="M24 20 L28 39"/><path d="M28 39 L26 55 L34 57"/>
    <path d="M40 20 L37 39 L39 55 L46 57" stroke-opacity=".35"/>
    <circle cx="24" cy="19.5" r="4.5" fill="currentColor" fill-opacity=".16"/><circle cx="28" cy="39" r="4.5" fill="currentColor" fill-opacity=".16"/></svg>`,
};

export const REGIONS = [
  {
    id: "shoulder", name: "Shoulder & Arm",
    desc: "Rotator cuff strength, shoulder mobility, and elbow and wrist function.",
    lede: "Exercises for shoulder strength and range of motion, plus elbow and wrist rehabilitation. Shoulder exercises use the right arm.",
    exercises: [
      { ex: "arm_abduction", name: "Shoulder Abduction", targets: "Deltoid and supraspinatus",
        why: "Strengthens lifting the arm out to the side, a common goal after rotator cuff injury.", tags: ["Right arm", "Standing"],
        icon: fig(STAND + `<path d="M25 19 L41 9"/><path d="M31 27 A 10 10 0 0 0 36 18" ${DASH}/>`) },
      { ex: "shoulder_extension", name: "Shoulder Extension", targets: "Posterior deltoid, latissimus dorsi and teres major",
        why: "Restores reaching behind the body. Paced by spoken cues.", tags: ["Right arm", "Standing", "Paced"],
        icon: fig(`<circle cx="30" cy="10" r="4.5"/><path d="M30 16 V32"/><path d="M30 32 L27 47"/><path d="M30 32 L33 47"/><path d="M30 19 L19 29"/><path d="M17 18 A 12 12 0 0 0 15 30" ${DASH}/><path d="M12.5 26.5 L15 30.5 L18.5 27.5" stroke-width="2"/>`) },
      { ex: "shoulder_abduction_full", name: "Shoulder Abduction AROM", targets: "Glenohumeral and scapulothoracic motion",
        why: "Active range of motion to full overhead elevation, after injury, surgery or adhesive capsulitis.", tags: ["Right arm", "Standing"],
        icon: fig(STAND + `<path d="M25 19 L35 4"/><path d="M41 30 A 16 16 0 0 0 39 11" ${DASH}/><path d="M36.5 12.5 L39.5 10 L41.5 13.5" stroke-width="2"/>`) },
      { ex: "shoulder_adduction", name: "Shoulder Horizontal Adduction", targets: "Pectoralis major and anterior deltoid",
        why: "Improves reaching across the body and stretches the posterior shoulder capsule.", tags: ["Right arm", "Standing"],
        icon: fig(STAND + `<path d="M25 19 L10 25"/><path d="M33 31 A 14 14 0 0 1 14 31" ${DASH}/><path d="M17.5 28.5 L14 31.5 L18 33.5" stroke-width="2"/>`) },
      { ex: "shoulder_external_rotation", name: "External Rotation at 90° Abduction", targets: "Infraspinatus and teres minor (rotator cuff)",
        why: "Builds external rotation range and rotator cuff control for overhead activity.", tags: ["Right arm", "Standing"],
        icon: fig(STAND + `<path d="M25 19 H38"/><path d="M38 19 V7"/><path d="M45 18 A 9 9 0 0 0 40 8" ${DASH}/><path d="M38.5 11 L40 7.5 L43 9.5" stroke-width="2"/>`) },
      { ex: "shoulder_internal_rotation", name: "Internal Rotation at 90° Abduction", targets: "Subscapularis (rotator cuff)",
        why: "Restores internal rotation range, often limited with shoulder stiffness.", tags: ["Right arm", "Standing"],
        icon: fig(STAND + `<path d="M25 19 H38"/><path d="M38 19 V31"/><path d="M45 20 A 9 9 0 0 1 40 30" ${DASH}/><path d="M38.5 27 L40 30.5 L43 28.5" stroke-width="2"/>`) },
      { ex: "arm_circles", name: "Shoulder Circumduction", targets: "Glenohumeral joint through all planes of motion",
        why: "Mobilizes the shoulder through its full arc. Used as a warm-up and for stiffness.", tags: ["Right arm", "Standing"],
        icon: fig(STAND + `<path d="M25 19 L38 10"/><circle cx="27" cy="19" r="15" ${DASH} stroke-opacity=".8"/>`) },
      { ex: "elbow_flexion", soon: true, name: "Elbow Flexion", targets: "Biceps brachii and brachialis",
        why: "Rebuilds elbow flexion strength after injury or immobilization.", tags: ["Standing"],
        icon: fig(STAND + `<path d="M25 19 L29 31"/><path d="M29 31 L37 22"/><path d="M35 19.5 L39.5 24" stroke-width="3.4"/>`) },
      { ex: "overhead_elbow_extension", soon: true, name: "Overhead Elbow Extension", targets: "Triceps brachii (long head)",
        why: "Strengthens elbow extension with the shoulder elevated.", tags: ["Standing"],
        icon: fig(`<circle cx="25" cy="12" r="4.5"/><path d="M25 18 V33"/><path d="M25 33 L20 48"/><path d="M25 33 L30 48"/><path d="M25 21 L19 32"/><path d="M27 20 L31 6"/><path d="M31 6 L24 2"/><path d="M38 9 A 9 9 0 0 0 33 1" ${DASH}/>`) },
      { ex: "wrist_extension", soon: true, name: "Wrist Extension AROM", targets: "Wrist extensors (ECRL, ECRB, ECU)",
        why: "Used in rehabilitation for lateral epicondylalgia (tennis elbow) and after wrist fracture.", tags: ["Seated"],
        icon: fig(`<path d="M6 32 H30"/><path d="M30 32 L41 21"/><path d="M41 21 L44 18"/><path d="M45 31 A 13 13 0 0 0 40 20" ${DASH}/><path d="M6 37 H30" stroke-opacity=".35"/>`) },
    ],
  },
  {
    id: "spine", name: "Spine & Core",
    desc: "Lumbar and thoracic mobility, trunk control and posture.",
    lede: "Exercises for spinal mobility and trunk control, commonly prescribed for low back pain.",
    exercises: [
      { ex: "prone_press_up", soon: true, name: "Prone Press-Up", targets: "Lumbar spine extension",
        why: "Extension-based exercise used in the management of low back pain.", tags: ["Lying face down"],
        icon: fig(`<path d="M6 48 H52" stroke-opacity=".35"/><path d="M50 45 L31 45"/><path d="M31 45 L19 31"/><circle cx="15" cy="26" r="4.5"/><path d="M22 34 L22 45"/>`) },
      { ex: "lateral_trunk_flexion", soon: true, name: "Standing Lateral Trunk Flexion", targets: "Obliques and quadratus lumborum",
        why: "Restores side-bending mobility of the spine.", tags: ["Standing"],
        icon: fig(`<path d="M24 32 L20 47"/><path d="M24 32 L28 47"/><path d="M24 32 Q25 21 33 15"/><circle cx="36" cy="11" r="4.5"/><path d="M31 18 L43 22"/><path d="M27 21 L16 27"/><path d="M44 30 A 16 16 0 0 0 42 12" ${DASH}/>`) },
      { ex: "trunk_rotation", soon: true, name: "Standing Trunk Rotation", targets: "Thoracic rotation and the obliques",
        why: "Improves rotational mobility of the trunk and core control.", tags: ["Standing"],
        icon: fig(`<circle cx="28" cy="9" r="4.5"/><path d="M28 15 V33"/><path d="M28 33 L23 48"/><path d="M28 33 L33 48"/><path d="M14 21 H42"/><ellipse cx="28" cy="27" rx="15" ry="5" ${DASH}/><path d="M40 30 L44 28.5 L41.5 25" stroke-width="2"/>`) },
      { ex: "pelvic_rotation", soon: true, name: "Pelvic Rotation", targets: "Lumbopelvic stabilizers and hip rotators",
        why: "Trains lumbopelvic control, a common goal in low back pain rehabilitation.", tags: ["Standing"],
        icon: fig(`<path d="M12 22 Q28 15 44 22 L39 34 H17 Z"/><path d="M20 34 L18 48"/><path d="M36 34 L38 48"/><ellipse cx="28" cy="40" rx="17" ry="5" ${DASH}/><path d="M41 43 L45 41.5 L42 38" stroke-width="2"/>`) },
    ],
  },
  {
    id: "lower", name: "Hip & Knee",
    desc: "Hip stability, knee control and lower-limb strength.",
    lede: "Exercises for lower-limb strength, hip stability and knee control.",
    exercises: [
      { ex: "squat", name: "Bodyweight Squat", targets: "Quadriceps, gluteus maximus and hamstrings",
        why: "Builds lower-limb strength and knee control for sitting, standing and stairs.", tags: ["Both legs", "Standing"],
        icon: fig(`<circle cx="31" cy="10" r="4.5"/><path d="M29 16 L22 30"/><path d="M27 19 L40 23"/><path d="M22 30 L35 33 L31 46"/><path d="M31 46 L38 46"/><path d="M12 50 H44" stroke-opacity=".35"/>`) },
      { ex: "hip_abduction", soon: true, name: "Standing Hip Abduction", targets: "Gluteus medius and minimus",
        why: "Improves pelvic stability for walking and balance.", tags: ["Standing"],
        icon: fig(`<circle cx="25" cy="10" r="4.5"/><path d="M25 16 V32"/><path d="M25 32 L22 47"/><path d="M25 32 L37 45"/><path d="M25 19 L19 30"/><path d="M25 19 L31 30"/><path d="M27 48 A 14 14 0 0 0 36 40" ${DASH}/>`) },
      { ex: "split_squat", soon: true, name: "Split Squat", targets: "Quadriceps and gluteus maximus, single-leg control",
        why: "Builds single-leg strength and knee stability.", tags: ["Standing"],
        icon: fig(`<circle cx="27" cy="8" r="4.5"/><path d="M27 14 V30"/><path d="M27 30 L38 32 L38 46"/><path d="M27 30 L18 40 L12 46"/><path d="M27 18 L22 28"/><path d="M27 18 L32 28"/><path d="M8 48 H46" stroke-opacity=".35"/>`) },
      { ex: "sit_to_stand", soon: true, name: "Sit-to-Stand", targets: "Quadriceps and gluteals",
        why: "Functional strength for everyday transfers, and a standard measure of fall risk.", tags: ["Chair"],
        icon: fig(`<path d="M8 30 H22 V48"/><path d="M8 30 V48"/><path d="M8 20 V30" stroke-opacity=".6"/><circle cx="33" cy="9" r="4.5"/><path d="M32 15 L29 30"/><path d="M29 30 L34 38 L33 48"/><path d="M31 18 L38 26"/><path d="M41 22 A 12 12 0 0 0 40 9" ${DASH}/>`) },
      { ex: "supine_hip_flexion", soon: true, name: "Supine Hip and Knee Flexion", targets: "Iliopsoas, hip flexion range",
        why: "Restores hip flexion range after hip or knee surgery.", tags: ["Lying on back"],
        icon: fig(`<path d="M4 46 H52" stroke-opacity=".35"/><circle cx="9" cy="39" r="4.5"/><path d="M14 41 H32"/><path d="M32 41 H50"/><path d="M32 41 L38 28 L45 36"/><path d="M46 26 A 12 12 0 0 0 36 22" ${DASH}/>`) },
    ],
  },
];

export const ARROW = `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
export const regionArt = (id) => REGION_ART[id];
export const findExercise = (ex) => {
  for (const r of REGIONS) { const e = r.exercises.find((x) => x.ex === ex); if (e) return { region: r, item: e }; }
  return null;
};
