import express from "express";
import path from "path";
import dns from "dns";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { User, Match, Vote, Award, ContextCard, Question, Alternativa, AdminMetrics } from "./src/types";
import { clubs } from "./src/data/clubs";

const PORT = 3000;
const app = express();
app.use(express.json());

// In-Memory & File Persisted Database Emulator
const DB_FILE = path.join(process.cwd(), "db_store.json");

interface LocalDB {
  users: User[];
  matches: Match[];
  votes: Vote[];
  awards: Award[];
  contexts: ContextCard[];
  questions: Question[];
  activeUserId: string;
}

let db: LocalDB = {
  users: [],
  matches: [],
  votes: [],
  awards: [],
  contexts: [],
  questions: [],
  activeUserId: "user_alex_g"
};

function getLocalShortClubName(value: string | undefined | null): string {
  if (!value) return "";
  const name = value.trim();
  if (name.includes("Paris") || name.includes("PSG")) return "PSG";
  if (name.includes("Marseille")) return "Marseille";
  if (name.includes("Real Madrid")) return "Real Madrid";
  if (name.includes("Manchester City") || name.includes("Man. City") || name.includes("Man City")) return "Man. City";
  if (name.includes("Liverpool")) return "Liverpool";
  if (name.includes("Arsenal")) return "Arsenal";
  if (name.includes("Getafe")) return "Getafe";
  if (name.includes("Leganés") || name.includes("Leganes")) return "Leganés";
  if (name.includes("Sassuolo")) return "Sassuolo";
  if (name.includes("Empoli")) return "Empoli";
  if (name.includes("Barcelona")) return "Barcelona";
  if (name.includes("United")) return "Man. United";
  
  return name.replace(/\b(FC|CF|SD|CD|UD|SSC|RC|SL|AC|SC|AS|FK|AFC|München)\b/g, "").trim();
}

function ensureMatchQuestions(match: any) {
  if (match.estado_tarjeta !== "Active") return;

  const short1 = getLocalShortClubName(match.club_1);
  const short2 = getLocalShortClubName(match.club_2);

  // 1. Prematch Question (for all active matches)
  const qPrematchId = `q_prematch_90_${match.id}`;
  let existsPrematch = db.questions.find((q: any) => q.id === qPrematchId || (q.contenedor_id === match.id && q.texto_pregunta && q.texto_pregunta.es === "¿Quién ganará en los 90 minutos?"));
  
  const prematchTarget: Question = {
    id: qPrematchId,
    contenedor_id: match.id,
    modelo_contenedor: "Match",
    modulo_origen: "Matchs",
    texto_pregunta: {
      es: "¿Quién ganará en los 90 minutos?",
      en: "Who will win in 90 minutes?",
      pt: "Quem vencerá nos 90 minutos?"
    },
    estado_pregunta: "Upcoming_Active" as "Upcoming_Active" | "Upcoming_Readonly",
    tipo_origen: "Automatic_API",
    alternativas: [
      {
        id: `alt_prematch_95_1_${match.id}`,
        texto: { es: short1, en: short1, pt: short1 },
        votos: 0
      },
      {
        id: `alt_prematch_95_2_${match.id}`,
        texto: { es: "Empate", en: "Draw", pt: "Empate" },
        votos: 0
      },
      {
        id: `alt_prematch_95_3_${match.id}`,
        texto: { es: short2, en: short2, pt: short2 },
        votos: 0
      }
    ]
  };

  if (!existsPrematch) {
    if (match.match_status === "Live" || match.match_status === "Finished") {
      prematchTarget.estado_pregunta = "Upcoming_Readonly";
    }
    db.questions.push(prematchTarget);
  } else {
    // Sync the alternativas text so it uses short names
    existsPrematch.id = qPrematchId; 
    existsPrematch.alternativas[0].texto = { es: short1, en: short1, pt: short1 };
    existsPrematch.alternativas[1].texto = { es: "Empate", en: "Draw", pt: "Empate" };
    existsPrematch.alternativas[2].texto = { es: short2, en: short2, pt: short2 };
    
    if (match.match_status === "Live" || match.match_status === "Finished") {
      existsPrematch.estado_pregunta = "Upcoming_Readonly";
    }
  }

  // 2. Extra questions for finished matches
  if (match.match_status === "Finished") {
    // 2a. Minute 80 Question: ¿Jugador del partido?
    const qM80Id = `q_m80_${match.id}`;
    let existsM80 = db.questions.find((q: any) => q.id === qM80Id || (q.contenedor_id === match.id && q.texto_pregunta && q.texto_pregunta.es === "¿Jugador del partido?"));
    
    let players = ["Estrella Local", "Estrella Visitante", "Revelación"];
    if (short1 === "PSG") {
      players = ["Ousmane Dembélé", "Vitinha", "Pierre-Emerick Aubameyang"];
    } else if (short1 === "Liverpool") {
      players = ["Mohamed Salah", "Virgil van Dijk", "Bukayo Saka"];
    } else if (short1 === "Real Madrid") {
      players = ["Vinícius Júnior", "Jude Bellingham", "Erling Haaland"];
    } else if (short1 === "Empoli") {
      players = ["M'Baye Niang", "Sebastiano Luperto", "Domenico Berardi"];
    } else {
      players = [`Estrella de ${short1}`, `Volante de ${short2}`, `Defensor Destacado`];
    }

    if (!existsM80) {
      db.questions.push({
        id: qM80Id,
        contenedor_id: match.id,
        modelo_contenedor: "Match",
        modulo_origen: "Matchs",
        texto_pregunta: {
          es: "¿Jugador del partido?",
          en: "Man of the match?",
          pt: "Craque do jogo?"
        },
        estado_pregunta: "Live",
        tipo_origen: "Automatic_API",
        minuto: "80'",
        alternativas: [
          { id: `alt_m80_1_${match.id}`, texto: { es: players[0], en: players[0], pt: players[0] }, votos: 0 },
          { id: `alt_m80_2_${match.id}`, texto: { es: players[1], en: players[1], pt: players[1] }, votos: 0 },
          { id: `alt_m80_3_${match.id}`, texto: { es: players[2], en: players[2], pt: players[2] }, votos: 0 }
        ]
      });
    }

    // 2b. Postmatch Question: ¿Quién se va entre aplausos hoy?
    const qPostmatchId = `q_postmatch_${match.id}`;
    let existsPostmatch = db.questions.find((q: any) => q.id === qPostmatchId || (q.contenedor_id === match.id && q.texto_pregunta && q.texto_pregunta.es === "¿Quién se va entre aplausos hoy?"));
    
    const postmatchTarget: Question = {
      id: qPostmatchId,
      contenedor_id: match.id,
      modelo_contenedor: "Match",
      modulo_origen: "Matchs",
      texto_pregunta: {
        es: "¿Quién se va entre aplausos hoy?",
        en: "Who walks off to applause today?",
        pt: "Quem sai aplaudido hoje?"
      },
      estado_pregunta: "Finished",
      tipo_origen: "Automatic_API",
      alternativas: [
        {
          id: `alt_post_1_${match.id}`,
          texto: {
            es: "Ninguno",
            en: "None",
            pt: "Nenhum"
          },
          votos: 0
        },
        {
          id: `alt_post_2_${match.id}`,
          texto: {
            es: `Solo el ${short1}`,
            en: `Only ${short1}`,
            pt: `Apenas o ${short1}`
          },
          votos: 0
        },
        {
          id: `alt_post_3_${match.id}`,
          texto: {
            es: `Solo el ${short2}`,
            en: `Only ${short2}`,
            pt: `Apenas o ${short2}`
          },
          votos: 0
        },
        {
          id: `alt_post_4_${match.id}`,
          texto: {
            es: "Ambos",
            en: "Both",
            pt: "Ambos"
          },
          votos: 0
        }
      ]
    };

    if (!existsPostmatch) {
      db.questions.push(postmatchTarget);
    } else {
      existsPostmatch.id = qPostmatchId; 
      existsPostmatch.alternativas = [
        {
          id: `alt_post_1_${match.id}`,
          texto: { es: "Ninguno", en: "None", pt: "Nenhum" },
          votos: existsPostmatch.alternativas[0]?.votos || 0
        },
        {
          id: `alt_post_2_${match.id}`,
          texto: { es: `Solo el ${short1}`, en: `Only ${short1}`, pt: `Apenas o ${short1}` },
          votos: existsPostmatch.alternativas[1]?.votos || 0
        },
        {
          id: `alt_post_3_${match.id}`,
          texto: { es: `Solo el ${short2}`, en: `Only ${short2}`, pt: `Apenas o ${short2}` },
          votos: existsPostmatch.alternativas[2]?.votos || 0
        },
        {
          id: `alt_post_4_${match.id}`,
          texto: { es: "Ambos", en: "Both", pt: "Ambos" },
          votos: existsPostmatch.alternativas[3]?.votos || 0
        }
      ];
    }
  }
}

// Seed initial database state if file doesn't exist
function loadDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    } catch (e) {
      console.error("Error reading database store. Re-seeding...", e);
      seedDatabase();
    }
  } else {
    seedDatabase();
  }

  // Force-remove ctx_wc context card from database dynamically
  if (db.contexts) {
    db.contexts = db.contexts.filter(c => c.id !== "ctx_wc");
  }

  // Force-update q_ctx_wc_1 and q_ctx_g_1 to the requested question and options to guarantee persistence across environments
  if (db.questions) {
    // 0. Force-remove q_ctx_es_1 and q_mc_rm_1
    db.questions = db.questions.filter(q => q.id !== "q_ctx_es_1" && q.id !== "q_mc_rm_1");

    // Force-clean q_ctx_es_club_rm question text to remove prefix
    const qIndexRm = db.questions.findIndex(q => q.id === "q_ctx_es_club_rm");
    if (qIndexRm !== -1) {
      db.questions[qIndexRm].texto_pregunta = {
        es: "¿Debería volver Cristiano Ronaldo al Real Madrid como Embajador?",
        en: "Should Cristiano Ronaldo return to Real Madrid as an Ambassador?",
        pt: "Cristiano Ronaldo deveria retornar ao Real Madrid como Embaixador?"
      };
    }

    // 1. Force-update q_ctx_wc_1
    const qIndexWc = db.questions.findIndex(q => q.id === "q_ctx_wc_1");
    const targetWc = {
      id: "q_ctx_wc_1",
      contenedor_id: "ctx_wc",
      modelo_contenedor: "Context",
      modulo_origen: "Context",
      texto_pregunta: {
        es: "El VAR ahora revisará los córners",
        en: "VAR will now review corner kicks",
        pt: "O VAR agora vai revisar os escanteios"
      },
      estado_pregunta: "Live",
      tipo_origen: "Manual_CMS",
      alternativas: [
        {
          id: "alt_ctx_wc1_1",
          texto: {
            es: "Excelente, asegura que el juego sea justo",
            en: "Excellent, ensures the game is fair",
            pt: "Excelente, garante que o jogo seja justo"
          },
          votos: 450
        },
        {
          id: "alt_ctx_wc1_2",
          texto: {
            es: "Malo, se pierde la dinámica del partido",
            en: "Bad, the game dynamics are lost",
            pt: "Ruim, perde-se a dinâmica da partida"
          },
          votos: 920
        }
      ]
    };
    if (qIndexWc !== -1) {
      db.questions[qIndexWc] = { ...db.questions[qIndexWc], ...targetWc } as any;
    } else {
      db.questions.push(targetWc as any);
    }

    // 2. Force-update q_ctx_g_1 (Matches "The Best" container displayed in user's screenshot)
    const qIndexG = db.questions.findIndex(q => q.id === "q_ctx_g_1");
    const targetG = {
      id: "q_ctx_g_1",
      contenedor_id: "ctx_global",
      modelo_contenedor: "Context" as const,
      modulo_origen: "Context",
      texto_pregunta: {
        es: "El VAR ahora revisará los córners",
        en: "VAR will now review corner kicks",
        pt: "O VAR agora vai revisar os escanteios"
      },
      estado_pregunta: "Live",
      tipo_origen: "Manual_CMS",
      categoria_contexto: "Global/Mundo",
      alternativas: [
        {
          id: "alt_g1_1",
          texto: {
            es: "Excelente, asegura que el juego sea justo",
            en: "Excellent, ensures the game is fair",
            pt: "Excelente, garante que o jogo seja justo"
          },
          votos: 450
        },
        {
          id: "alt_g1_2",
          texto: {
            es: "Malo, se pierde la dinámica del partido",
            en: "Bad, the game dynamics are lost",
            pt: "Ruim, perde-se a dinâmica da partida"
          },
          votos: 920
        }
      ]
    };
    if (qIndexG !== -1) {
      db.questions[qIndexG] = { ...db.questions[qIndexG], ...targetG } as any;
    } else {
      db.questions.push(targetG as any);
    }
  }

  // Ensure every active match has the necessary prematch/postmatch/minute 80 questions
  if (db.matches && db.questions) {
    db.matches.forEach((match: any) => {
      ensureMatchQuestions(match);
    });
  }

  saveDatabase();
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.error("Error saving database store:", e);
  }
}

function seedDatabase() {
  // 1. Seed Users
  db.users = [
    {
      id: "user_alex_g",
      auth0Id: "auth0|alexg_hincha",
      nombre_completo: "Alex G.",
      foto_perfil: "/src/assets/images/regenerated_image_1781135961683.png",
      nacionalidades: ["ES", "AR"], // España y Argentina
      genero: "Masculino",
      rango_edad: "25-34",
      clubes_favoritos: ["real_madrid", "man_city", "ac_milan", "dortmund", "river_plate"],
      dashboard: {
        debates_emitidos_partidos: 12,
        debates_emitidos_premios: 4,
        debates_emitidos_contexto: 8
      }
    },
    {
      id: "user_lucia_m",
      auth0Id: "auth0|luciam_hincha",
      nombre_completo: "Lucía M.",
      foto_perfil: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      nacionalidades: ["BR"], // Brasil
      genero: "Femenino",
      rango_edad: "18-24",
      clubes_favoritos: ["flamengo", "barcelona_sc", "real_madrid"],
      dashboard: {
        debates_emitidos_partidos: 8,
        debates_emitidos_premios: 6,
        debates_emitidos_contexto: 10
      }
    },
    {
      id: "user_john_d",
      auth0Id: "auth0|johnd_hincha",
      nombre_completo: "John D. (Gales)",
      foto_perfil: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      nacionalidades: ["GB-WLS"], // Gales
      genero: "No binario",
      rango_edad: "35-44",
      clubes_favoritos: ["man_united", "seattle_sounders"],
      dashboard: {
        debates_emitidos_partidos: 3,
        debates_emitidos_premios: 2,
        debates_emitidos_contexto: 1
      }
    },
    {
      id: "visitor",
      auth0Id: "auth0|visitor_anonymous",
      nombre_completo: "Hincha Anónimo (Namibia)",
      foto_perfil: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
      nacionalidades: ["NA"], // Namibia
      genero: "Prefiero no decirlo",
      rango_edad: "45+",
      clubes_favoritos: [],
      dashboard: {
        debates_emitidos_partidos: 0,
        debates_emitidos_premios: 0,
        debates_emitidos_contexto: 0
      }
    }
  ];

  db.activeUserId = "user_alex_g";

  // 2. Seed Matches
  db.matches = [
    {
      id: "match_1",
      api_match_id: "api_cl_rm_mc",
      club_1: "Real Madrid CF",
      club_2: "Manchester City FC",
      torneo_nombre: "Champions League",
      fecha_inicio: new Date(Date.now() - 3600000 * 1.5).toISOString(), // started 1.5 hours ago
      estado_tarjeta: "Active",
      match_status: "Live",
      score_home: 2,
      score_away: 1,
      minute: 78
    },
    {
      id: "match_2",
      api_match_id: "api_pl_liv_ars",
      club_1: "Liverpool FC",
      club_2: "Arsenal FC",
      torneo_nombre: "Premier League",
      fecha_inicio: new Date(Date.now() + 3600000 * 3).toISOString(), // starts in 3 hours
      estado_tarjeta: "Active",
      match_status: "Not_Started"
    },
    {
      id: "match_3",
      api_match_id: "api_l1_psg_om",
      club_1: "Paris Saint-Germain FC",
      club_2: "Olympique de Marseille",
      torneo_nombre: "Ligue 1",
      fecha_inicio: new Date(Date.now() - 3600000 * 5).toISOString(), // finished hours ago
      estado_tarjeta: "Active",
      match_status: "Finished",
      score_home: 0,
      score_away: 0
    },
    // The "Waiting List" Match: Torneo importante but neither plays in popular clubs (Getafe and Leganes are not popular)
    {
      id: "match_grey_1",
      api_match_id: "api_laliga_get_leg",
      club_1: "Getafe CF",
      club_2: "CD Leganés",
      torneo_nombre: "LaLiga",
      fecha_inicio: new Date(Date.now() + 3600000 * 20).toISOString(),
      estado_tarjeta: "Pending", // Needs admin manual review!
      match_status: "Not_Started"
    },
    // Another Waiting List: Empoli vs Sassuolo (Serie A match, neither is a popular club)
    {
      id: "match_grey_2",
      api_match_id: "api_seriea_emp_sas",
      club_1: "Empoli FC",
      club_2: "US Sassuolo Calcio",
      torneo_nombre: "Serie A",
      fecha_inicio: new Date(Date.now() + 3600000 * 48).toISOString(),
      estado_tarjeta: "Pending",
      match_status: "Not_Started"
    }
  ];

  // 3. Seed Awards (Premiaciones)
  db.awards = [
    {
      id: "award_wc",
      torneo_nombre: "World Cup 2026",
      logo_url: "🏆",
      fecha_inicio: "2026-06-01",
      fecha_fin: "2026-07-01",
      fans: 1234567,
      debatesCount: 5
    },
    {
      id: "award_dor",
      torneo_nombre: "Ballon d'Or Ceremony 2026",
      logo_url: "⚽",
      fecha_inicio: "2026-10-26",
      fecha_fin: "2026-10-27",
      fans: 1009292,
      debatesCount: 10
    },
    {
      id: "award_ucl",
      torneo_nombre: "Champions League 2025–26",
      logo_url: "⭐️",
      fecha_inicio: "2025-09-15",
      fecha_fin: "2026-06-01",
      fans: 2845012,
      debatesCount: 6
    },
    {
      id: "award_wwc",
      torneo_nombre: "Women's World Cup 2027",
      logo_url: "🏃‍♀️",
      fecha_inicio: "2027-09-01",
      fecha_fin: "2027-09-30",
      fans: 156402,
      debatesCount: 4
    }
  ];

  // 4. Seed Context Cards
  db.contexts = [
    { id: "ctx_global", nombre_region: "GLOBAL", countryCode: "GLOBAL", bandera_url: "🌍", estado_activo: true, fans: 1201349, debatesCount: 10, leagueName: "Football | Worldwide" },
    { id: "ctx_spain", nombre_region: "España", countryCode: "ES", bandera_url: "🇪🇸", estado_activo: true, fans: 800901, debatesCount: 15, leagueName: "LaLiga | 20 Clubs" },
    { id: "ctx_england", nombre_region: "Inglaterra", countryCode: "GB-ENG", bandera_url: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", estado_activo: true, fans: 55762902, debatesCount: 12, leagueName: "Premier League | 20 Clubs" },
    { id: "ctx_brazil", nombre_region: "Brasil", countryCode: "BR", bandera_url: "🇧🇷", estado_activo: true, fans: 2981401, debatesCount: 12, leagueName: "Brasileirão | 20 Clubs" }
  ];

  // 5. Seed Questions & Alternativas
  db.questions = [
    // Real Madrid vs Man City Match Questions
    {
      id: "q_mc_rm_2",
      contenedor_id: "match_1",
      modelo_contenedor: "Match",
      modulo_origen: "Matchs",
      texto_pregunta: {
        es: "[Minuto 60] ¿Penal bien cobrado para el Real Madrid?",
        en: "[Minute 60] Was that a well-taken penalty for Real Madrid?",
        pt: "[Minuto 60] Pênalti bem marcado para o Real Madrid?"
      },
      estado_pregunta: "Live",
      tipo_origen: "Automatic_API",
      alternativas: [
        { id: "alt_mc_2_1", texto: { es: "Sí, definitivamente", en: "Yes, definitely", pt: "Sim, com certeza" }, votos: 5100 },
        { id: "alt_mc_2_2", texto: { es: "Difícil decir", en: "Hard to say", pt: "Difícil dizer" }, votos: 800 },
        { id: "alt_mc_2_3", texto: { es: "No, para nada", en: "No, not at all", pt: "Não, de jeito nenhum" }, votos: 1200 }
      ]
    },
    {
      id: "q_mc_rm_3",
      contenedor_id: "match_1",
      modelo_contenedor: "Match",
      modulo_origen: "Matchs",
      texto_pregunta: {
        es: "¿Quién ganará en los 90 minutos?",
        en: "Who will win in 90 minutes?",
        pt: "Quem vencerá nos 90 minutos?"
      },
      estado_pregunta: "Upcoming_Readonly",
      tipo_origen: "Automatic_API",
      alternativas: [
        { id: "alt_mc_3_1", texto: { es: "Real Madrid CF", en: "Real Madrid CF", pt: "Real Madrid CF" }, votos: 12000 },
        { id: "alt_mc_3_2", texto: { es: "Empate", en: "Draw", pt: "Empate" }, votos: 3100 },
        { id: "alt_mc_3_3", texto: { es: "Manchester City", en: "Man. City", pt: "Manchester City" }, votos: 5500 }
      ]
    },

    // Global Context Questions
    {
      id: "q_ctx_g_1",
      contenedor_id: "ctx_global",
      modelo_contenedor: "Context",
      modulo_origen: "Context",
      texto_pregunta: {
        es: "El VAR ahora revisará los córners",
        en: "VAR will now review corner kicks",
        pt: "O VAR agora vai revisar os escanteios"
      },
      estado_pregunta: "Live",
      tipo_origen: "Manual_CMS",
      categoria_contexto: "Global/Mundo", // Anyone can vote!
      alternativas: [
        { id: "alt_g1_1", texto: { es: "Excelente, asegura que el juego sea justo", en: "Excellent, ensures the game is fair", pt: "Excelente, garante que o jogo seja justo" }, votos: 450 },
        { id: "alt_g1_2", texto: { es: "Malo, se pierde la dinámica del partido", en: "Bad, the game dynamics are lost", pt: "Ruim, perde-se a dinâmica da partida" }, votos: 920 }
      ]
    },

    // Spain Club-specific Question: Restricted to ONLY Real Madrid fans!
    {
      id: "q_ctx_es_club_rm",
      contenedor_id: "ctx_spain",
      modelo_contenedor: "Context",
      modulo_origen: "Context",
      texto_pregunta: {
        es: "¿Debería volver Cristiano Ronaldo al Real Madrid como Embajador?",
        en: "Should Cristiano Ronaldo return to Real Madrid as an Ambassador?",
        pt: "Cristiano Ronaldo deveria retornar ao Real Madrid como Embaixador?"
      },
      estado_pregunta: "Live",
      tipo_origen: "Manual_CMS",
      categoria_contexto: "España",
      club_restriccion: "real_madrid", // ONLY "real_madrid" is allowed to vote
      alternativas: [
        { id: "alt_es_c1", texto: { es: "Sí, de inmediato", en: "Yes, immediately", pt: "Sim, imediatamente" }, votos: 1520 },
        { id: "alt_es_c2", texto: { es: "No, el ciclo está cerrado", en: "No, the cycle is over", pt: "Não, o ciclo está encerrado" }, votos: 460 },
        { id: "alt_es_c3", texto: { es: "Solo si tiene un rol deportivo", en: "Only with active sports role", pt: "Apenas com papel esportivo ativo" }, votos: 310 }
      ]
    },

    // Awards Debates: World Cup
    {
      id: "q_aw_wc_1",
      contenedor_id: "award_wc",
      modelo_contenedor: "Award",
      modulo_origen: "Awards",
      texto_pregunta: {
        es: "¿Qué selección se coronará campeona?",
        en: "Which national team will be crowned champion?",
        pt: "Qual seleção será coroada campeã?"
      },
      estado_pregunta: "Live",
      tipo_origen: "Manual_CMS",
      alternativas: [
        { id: "alt_aw_wc1_1", texto: { es: "[DE] Alemania", en: "[DE] Germany", pt: "[DE] Alemanha" }, votos: 450 },
        { id: "alt_aw_wc1_2", texto: { es: "[AR] Argentina", en: "[AR] Argentina", pt: "[AR] Argentina" }, votos: 920 },
        { id: "alt_aw_wc1_3", texto: { es: "[BR] Brasil", en: "[BR] Brazil", pt: "[BR] Brasil" }, votos: 800 },
        { id: "alt_aw_wc1_4", texto: { es: "[ES] España", en: "[ES] Spain", pt: "[ES] Espanha" }, votos: 1150 },
        { id: "alt_aw_wc1_5", texto: { es: "[FR] Francia", en: "[FR] France", pt: "[FR] França" }, votos: 1050 },
        { id: "alt_aw_wc1_6", texto: { es: "[ENG] Inglaterra", en: "[ENG] England", pt: "[ENG] Inglaterra" }, votos: 730 },
        { id: "alt_aw_wc1_7", texto: { es: "[NL] Países Bajos", en: "[NL] Netherlands", pt: "[NL] Países Baixos" }, votos: 310 },
        { id: "alt_aw_wc1_8", texto: { es: "[PT] Portugal", en: "[PT] Portugal", pt: "[PT] Portugal" }, votos: 640 },
        { id: "alt_aw_wc1_9", texto: { es: "Otro", en: "Other", pt: "Outro" }, votos: 250 }
      ]
    },

    // Context Debates: World Cup
    {
      id: "q_ctx_wc_1",
      contenedor_id: "ctx_wc",
      modelo_contenedor: "Context",
      modulo_origen: "Context",
      texto_pregunta: {
        es: "El VAR ahora revisará los córners",
        en: "VAR will now review corner kicks",
        pt: "O VAR agora vai revisar os escanteios"
      },
      estado_pregunta: "Live",
      tipo_origen: "Manual_CMS",
      alternativas: [
        { id: "alt_ctx_wc1_1", texto: { es: "Excelente, asegura que el juego sea justo", en: "Excellent, ensures the game is fair", pt: "Excelente, garante que o jogo seja justo" }, votos: 450 },
        { id: "alt_ctx_wc1_2", texto: { es: "Malo, se pierde la dinámica del partido", en: "Bad, the game dynamics are lost", pt: "Ruim, perde-se a dinâmica da partida" }, votos: 920 }
      ]
    }
  ];

  // Auto-fill the default active matches with their standard questions during seeding
  db.matches.forEach((match: any) => {
    ensureMatchQuestions(match);
  });

  // 6. Pre-fill some votes
  db.votes = [
    { id: "vote_seed_1", user_id: "user_alex_g", question_id: "q_mc_rm_2", alternativa_id: "alt_mc_2_1" },
    { id: "vote_seed_2", user_id: "user_alex_g", question_id: "q_aw_wc_1", alternativa_id: "alt_aw_wc1_2" }
  ];
}

loadDatabase();

// API Helper to translate to appropriate language
const aiService = {
  generateAIQuestion: async (templates: any, variables: any) => {
    const result: any = {};
    for (const [lang, template] of Object.entries(templates)) {
      let promptText = template as string;
      for (const [key, value] of Object.entries(variables)) {
        promptText = promptText.replace(`{${key}}`, value as string);
      }
      result[lang] = promptText;
    }
    return result;
  }
};

// ---------------- SERVER ENDPOINTS ----------------

// Helper to get active user
const getActiveUser = (): User => {
  const user = db.users.find(u => u.id === db.activeUserId);
  if (!user) {
    return db.users[0]; // fallback
  }
  return user;
};

// Toggle Current active user for testing permissions
app.post("/api/users/switch", (req, res) => {
  const { userId } = req.body;
  const userExists = db.users.find(u => u.id === userId);
  if (userExists) {
    db.activeUserId = userId;
    saveDatabase();
    return res.json({ success: true, activeUserId: db.activeUserId, user: userExists });
  }
  res.status(404).json({ error: "User not found" });
});

app.get("/api/users/list", (req, res) => {
  res.json(db.users);
});

// Nationalities list (from spreadsheet parsed objects)
import { nationalities } from "./src/data/nationalities";
app.get("/api/nationalities", (req, res) => {
  res.json(nationalities);
});

// Clubs search dynamic combination helper
app.get("/api/clubs", (req, res) => {
  const search = (req.query.q || "").toString().toLowerCase();
  const lang = (req.query.lang || "en").toString().toLowerCase() as "es" | "en" | "pt";

  // Filter and enrich clubs with translated parent country
  let enriched = clubs.map(club => {
    const nat = nationalities.find(n => n.code === club.countryCode);
    const countryName = nat ? (nat.names[lang] || nat.names["en"]) : club.countryCode;
    return {
      ...club,
      displayName: `${club.name} (${countryName})`
    };
  });

  if (search) {
    enriched = enriched.filter(club =>
      club.name.toLowerCase().includes(search) ||
      club.displayName.toLowerCase().includes(search)
    );
  }

  res.json(enriched);
});

// Profile endpoints
app.get("/api/users/me", (req, res) => {
  const user = getActiveUser();
  // Calculate dynamic average total debates
  const total = user.dashboard.debates_emitidos_partidos +
                user.dashboard.debates_emitidos_premios +
                user.dashboard.debates_emitidos_contexto;
  res.json({ ...user, total_debates: total });
});

app.put("/api/users/me", (req, res) => {
  const user = getActiveUser();
  const { nombre_completo, nacionalidades, genero, rango_edad, clubes_favoritos } = req.body;

  if (nombre_completo) user.nombre_completo = nombre_completo;
  if (nacionalidades && Array.isArray(nacionalidades)) {
    if (nacionalidades.length > 3) return res.status(400).json({ error: "Máximo 3 nacionalidades permitidas" });
    user.nacionalidades = nacionalidades;
  }
  if (genero) user.genero = genero;
  if (rango_edad) user.rango_edad = rango_edad;
  if (clubes_favoritos && Array.isArray(clubes_favoritos)) {
    if (clubes_favoritos.length > 5) return res.status(400).json({ error: "Máximo 5 clubes favoritos permitidos" });
    user.clubes_favoritos = clubes_favoritos;
  }

  saveDatabase();
  res.json(user);
});

// Admin Metrics analytical breakdown
app.get("/api/admin/metrics", (req, res) => {
  const metrics: AdminMetrics = {
    totalUsers: db.users.length,
    usersByCountry: {},
    usersByClub: {}
  };

  db.users.forEach(user => {
    user.nacionalidades.forEach(code => {
      metrics.usersByCountry[code] = (metrics.usersByCountry[code] || 0) + 1;
    });
    user.clubes_favoritos.forEach(clubId => {
      metrics.usersByClub[clubId] = (metrics.usersByClub[clubId] || 0) + 1;
    });
  });

  res.json(metrics);
});

// GET matches list - public (estado_tarjeta: Active)
app.get("/api/matches", (req, res) => {
  const publicMatches = db.matches.filter(m => m.estado_tarjeta === "Active").map(m => {
    const count = db.questions.filter(q => q.contenedor_id === m.id).length;
    return { ...m, debatesCount: count };
  });
  res.json(publicMatches);
});

// GET all matches for admin (with user statistics counts for reviewed grey area)
app.get("/api/matches/admin", (req, res) => {
  const enriched = db.matches.map(match => {
    // We count how many registered fans of club_1 or club_2 are in this system
    const c1 = clubs.find(c => c.name === match.club_1 || c.id === match.club_1);
    const c2 = clubs.find(c => c.name === match.club_2 || c.id === match.club_2);

    let fansCount = 0;
    db.users.forEach(user => {
      if ((c1 && user.clubes_favoritos.includes(c1.id)) || (c2 && user.clubes_favoritos.includes(c2.id))) {
        fansCount++;
      }
    });

    const count = db.questions.filter(q => q.contenedor_id === match.id).length;
    return { ...match, fansCount, debatesCount: count };
  });

  res.json(enriched);
});

// Approve Pending Match (Review Waiting List switch)
app.post("/api/matches/:id/approve", (req, res) => {
  const { id } = req.params;
  const match = db.matches.find(m => m.id === id);
  if (!match) return res.status(404).json({ error: "Partido no encontrado" });

  match.estado_tarjeta = "Active";

  // Create standard questions list for safety
  ensureMatchQuestions(match);

  saveDatabase();
  res.json({ success: true, message: "Partido aprobado con éxito para la vista pública", match });
});

// GET Awards (Premiaciones)
app.get("/api/awards", (req, res) => {
  res.json(db.awards);
});

// GET Context cards (Sectores de países)
app.get("/api/contexts", (req, res) => {
  res.json(db.contexts);
});

// GET questions for a specific container (match, award, or context)
app.get("/api/questions/:containerId", (req, res) => {
  const { containerId } = req.params;
  const list = db.questions.filter(q => q.contenedor_id === containerId);
  
  const getPrio = (q: any) => {
    if (q.estado_pregunta === "Finished") {
      return 400; // Postmatch always on top
    }
    if (q.estado_pregunta === "Live") {
      let minVal = 0;
      if (q.minuto) {
        const parsed = parseInt(q.minuto.replace(/\D/g, ""), 10);
        if (!isNaN(parsed)) minVal = parsed;
      } else {
        const matchText = q.texto_pregunta && q.texto_pregunta.es;
        if (typeof matchText === "string") {
          const m = matchText.match(/Minuto\s+(\d+)/i) || matchText.match(/(\d+)'/);
          if (m) {
            const parsed = parseInt(m[1], 10);
            if (!isNaN(parsed)) minVal = parsed;
          }
        }
      }
      return 300 + minVal; // Live questions (e.g., 80' above 60')
    }
    return 100; // Prematch at the bottom
  };

  // Sort questions: Postmatch -> Live (higher minute first) -> Prematch, 
  // with newer created simulator questions (created_at) floating to the top of their group.
  const listWithIndex = list.map((q, idx) => ({ q, idx }));
  listWithIndex.sort((a, b) => {
    const prioA = getPrio(a.q);
    const prioB = getPrio(b.q);
    if (prioB !== prioA) {
      return prioB - prioA;
    }
    const timeA = a.q.created_at || 0;
    const timeB = b.q.created_at || 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return a.idx - b.idx;
  });
  const sortedQuestions = listWithIndex.map(item => item.q);

  // Also provide user's specific vote IDs for this container so they are highlighted
  const user = getActiveUser();
  const userVotes = db.votes.filter(v => v.user_id === user.id);
  
  res.json({
    questions: sortedQuestions,
    userVotes: userVotes.reduce((acc: any, curr) => {
      acc[curr.question_id] = curr.alternativa_id;
      return acc;
    }, {})
  });
});

// CAST VOTE WITH RESTRICTIVE SEGMENTATION RULES
app.post("/api/vote", (req, res) => {
  const user = getActiveUser();
  const { question_id, alternativa_id } = req.body;

  const question = db.questions.find(q => q.id === question_id);
  if (!question) return res.status(404).json({ error: "Pregunta/Debate no encontrado" });

  // 1. Strict Permission Checks for "Context" (Sectores por país)
  if (question.modelo_contenedor === "Context") {
    const parentContainer = db.contexts.find(c => c.id === question.contenedor_id);
    if (parentContainer) {
      if (parentContainer.countryCode !== "GLOBAL") {
        // Must match nationality
        const hasNationality = user.nacionalidades.includes(parentContainer.countryCode || "");
        if (!hasNationality) {
          return res.status(403).json({
            error: `Voto bloqueado. Tu nacionalidad no coincide con ${parentContainer.nombre_region}.`
          });
        }
      }

      // Check Club restriction if applicable (verified for global and non-global cards)
      if (question.club_restriccion) {
        const isFan = user.clubes_favoritos.includes(question.club_restriccion);
        if (!isFan) {
          const clubObj = clubs.find(c => c.id === question.club_restriccion);
          const clubName = clubObj ? clubObj.name : question.club_restriccion;
          return res.status(403).json({
            error: `Voto bloqueado. Solo permitido para hinchas del ${clubName}.`
          });
        }
      }
    }
  }

  // 2. Prevention of multiple votes or update vote choice
  const existingVote = db.votes.find(v => v.user_id === user.id && v.question_id === question_id);
  if (existingVote) {
    if (existingVote.alternativa_id === alternativa_id) {
      return res.json({ success: true, message: "Voto ya registrado en esta opción", user });
    }

    // Decrement previous choice votos
    const oldAlternative = question.alternativas.find(alt => alt.id === existingVote.alternativa_id);
    if (oldAlternative && oldAlternative.votos > 0) {
      oldAlternative.votos -= 1;
    }

    // Increment new choice votos
    const alternative = question.alternativas.find(alt => alt.id === alternativa_id);
    if (!alternative) return res.status(404).json({ error: "Opción de alternativa no encontrada" });
    
    alternative.votos += 1;
    existingVote.alternativa_id = alternativa_id;

    saveDatabase();
    return res.json({ success: true, message: "Voto actualizado correctamente", user });
  }

  // 3. Update vote counts safely for new vote
  const alternative = question.alternativas.find(alt => alt.id === alternativa_id);
  if (!alternative) return res.status(404).json({ error: "Opción de alternativa no encontrada" });

  alternative.votos += 1;

  // Save new Vote
  db.votes.push({
    id: `vote_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    user_id: user.id,
    question_id,
    alternativa_id
  });

  // Increment user's dashboard statistics
  if (question.modulo_origen === "Matchs") {
    user.dashboard.debates_emitidos_partidos += 1;
  } else if (question.modulo_origen === "Awards") {
    user.dashboard.debates_emitidos_premios += 1;
  } else if (question.modulo_origen === "Context") {
    user.dashboard.debates_emitidos_contexto += 1;
  }

  saveDatabase();
  res.json({ success: true, message: "Voto registrado correctamente", user });
});

// AUTOMATION WEBHOOK SIMULATOR ENDPOINT (from admin)
const WebhookController = {
  handleMatchWebhook: async (req: any, res: any) => {
    try {
      const { api_match_id, event, event_data } = req.body;
      const match = db.matches.find(m => m.api_match_id === api_match_id);
      if (!match) return res.status(404).json({ error: "Partido no encontrado" });

      // If the match is not active (blocked because it was filtered), do not consume
      if (match.estado_tarjeta !== "Active") {
        return res.status(400).json({ error: "Evento de webhook ignorado. El partido está bloqueado en la Zona Gris." });
      }

      switch (event) {
        case "KICKOFF":
          // Set upcoming questions to Upcoming_Readonly
          db.questions.forEach(q => {
            if (q.contenedor_id === match.id && q.estado_pregunta === "Upcoming_Active") {
              q.estado_pregunta = "Upcoming_Readonly";
            }
          });
          match.match_status = "Live";
          match.minute = 1;
          match.score_home = 0;
          match.score_away = 0;
          break;

        case "GOAL":
          if (event_data.team === "home") {
            match.score_home = (match.score_home || 0) + 1;
          } else {
            match.score_away = (match.score_away || 0) + 1;
          }
          match.minute = event_data.minuto || match.minute;
          break;

        case "PENALTY_CONFIRMED":
          const penaltyTemplates = {
            en: "Penalty well called for {CLUB_FAVORECIDO}?",
            es: "¿Penal bien cobrado para {CLUB_FAVORECIDO}?",
            pt: "Pênalti bien marcado para {CLUB_FAVORECIDO}?"
          };
          const penaltyText = await aiService.generateAIQuestion(penaltyTemplates, {
            MINUTO: event_data.minuto,
            CLUB_FAVORECIDO: event_data.club_favorecido
          });
          const penaltyList = [
            { id: `alt_p1_${Date.now()}`, texto: { es: "Sí, definitivamente", en: "Yes, definitely", pt: "Sim, com certeza" }, votos: 0 },
            { id: `alt_p2_${Date.now()}`, texto: { es: "Difícil decir", en: "Hard to say", pt: "Difícil dizer" }, votos: 0 },
            { id: `alt_p3_${Date.now()}`, texto: { es: "No, para nada", en: "No, not at all", pt: "Não, de jeito nenhum" }, votos: 0 }
          ];
          db.questions.push({
            id: `q_sim_${Date.now()}`,
            contenedor_id: match.id,
            modelo_contenedor: "Match",
            modulo_origen: "Matchs",
            texto_pregunta: penaltyText,
            estado_pregunta: "Live",
            tipo_origen: "Automatic_API",
            minuto: `${event_data.minuto || match.minute || 60} '`,
            created_at: Date.now(),
            alternativas: penaltyList
          });
          break;

        case "RED_CARD":
          const redCardTemplates = {
            en: "Red card for {JUGADOR_EXPULSADO}?",
            es: "¿Era para expulsión a {JUGADOR_EXPULSADO}?",
            pt: "Era para expulsão de {JUGADOR_EXPULSADO}?"
          };
          const redCardText = await aiService.generateAIQuestion(redCardTemplates, {
            MINUTO: event_data.minuto,
            JUGADOR_EXPULSADO: event_data.jugador
          });
          const redCardList = [
            { id: `alt_r1_${Date.now()}`, texto: { es: "Sí, definitivamente", en: "Yes, definitely", pt: "Sim, com certeza" }, votos: 0 },
            { id: `alt_r2_${Date.now()}`, texto: { es: "Difícil decir", en: "Hard to say", pt: "Difícil dizer" }, votos: 0 },
            { id: `alt_r3_${Date.now()}`, texto: { es: "No, para nada", en: "No, not at all", pt: "Não, de jeito nenhum" }, votos: 0 }
          ];
          db.questions.push({
            id: `q_sim_${Date.now()}`,
            contenedor_id: match.id,
            modelo_contenedor: "Match",
            modulo_origen: "Matchs",
            texto_pregunta: redCardText,
            estado_pregunta: "Live",
            tipo_origen: "Automatic_API",
            minuto: `${event_data.minuto || match.minute || 45} '`,
            created_at: Date.now(),
            alternativas: redCardList
          });
          break;

        case "MIN_80_REACHED":
          const motmText = {
            en: "Player of the match?",
            es: "¿Jugador del partido?",
            pt: "Melhor jogador da partida?"
          };
          db.questions.push({
            id: `q_sim_${Date.now()}`,
            contenedor_id: match.id,
            modelo_contenedor: "Match",
            modulo_origen: "Matchs",
            texto_pregunta: motmText,
            estado_pregunta: "Live",
            tipo_origen: "Automatic_API",
            minuto: "80 '",
            created_at: Date.now(),
            alternativas: [
              { id: `alt_m1_${Date.now()}`, texto: { es: "L. Messi", en: "L. Messi", pt: "L. Messi" }, votos: 0 },
              { id: `alt_m2_${Date.now()}`, texto: { es: "Vini Jr", en: "Vini Jr", pt: "Vini Jr" }, votos: 0 },
              { id: `alt_m3_${Date.now()}`, texto: { es: "K. Mbappé", en: "K. Mbappé", pt: "K. Mbappé" }, votos: 0 }
            ]
          });
          break;

        case "FULL_TIME":
          match.match_status = "Finished";
          // Close all Live questions
          db.questions.forEach(q => {
            if (q.contenedor_id === match.id && q.estado_pregunta === "Live") {
              q.estado_pregunta = "Finished";
            }
          });

          // Create Finished question
          const ftText = {
            en: "Who leaves to applause today?",
            es: "¿Quién se va entre aplausos hoy?",
            pt: "Quem sai aplaudido hoje?"
          };
          db.questions.push({
            id: `q_sim_${Date.now()}`,
            contenedor_id: match.id,
            modelo_contenedor: "Match",
            modulo_origen: "Matchs",
            texto_pregunta: ftText,
            estado_pregunta: "Finished",
            tipo_origen: "Automatic_API",
            created_at: Date.now(),
            alternativas: [
              { id: `alt_f1_${Date.now()}`, texto: { es: "Ninguno", en: "Neither", pt: "Nenhum" }, votos: 0 },
              { id: `alt_f2_${Date.now()}`, texto: { es: `Solo el ${match.club_1}`, en: `Only ${match.club_1}`, pt: `Só o ${match.club_1}` }, votos: 0 },
              { id: `alt_f3_${Date.now()}`, texto: { es: `Solo el ${match.club_2}`, en: `Only ${match.club_2}`, pt: `Só o ${match.club_2}` }, votos: 0 },
              { id: `alt_f4_${Date.now()}`, texto: { es: "Ambos", en: "Both", pt: "Ambos" }, votos: 0 }
            ]
          });
          break;
      }

      saveDatabase();
      res.status(200).json({ success: true, message: "Evento de API procesado correctamente", match });
    } catch (error) {
      res.status(500).json({ error: "Error interno del servidor al procesar el evento webhook" });
    }
  }
};

app.post("/api/webhooks/football", WebhookController.handleMatchWebhook);

// DAILY RESET AND INTEGRITY TEST (Simulate the 00:00 Daily Sync from Football API with filters)
app.post("/api/admin/simulate-daily-sync", (req, res) => {
  // Re-pull and check popularity rules:
  // 1. World Cup Tournament matches passes automatically.
  // 2. Champions League, Copa Libertadores, etc. pass if at least ONE is a top 100 popular club.
  // 3. Else, we add them to Pending lists (estado_tarjeta = 'Pending').
  
  // Reset all to clean seeds first to let them test endlessly
  seedDatabase();
  saveDatabase();
  res.json({ success: true, message: "Base de datos resincronizada con el calendario de las 00:00", matches: db.matches });
});

// START EXPRESS + VITE INTEGRATION RUNNER
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Force local DNS or host binding to bind perfectly
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`12VOX running on http://localhost:${PORT}`);
  });
}

startServer();
