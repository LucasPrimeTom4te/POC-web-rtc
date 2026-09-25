#!/usr/bin/env node
/*
 * MCP "sala": entra numa sala do app como mais uma pessoa, usando o app de
 * verdade num Chrome (o chat vai direto entre os aparelhos, por WebRTC: não
 * passa pelo Supabase, então só dá para ler estando na sala).
 *
 * As ferramentas devolvem só texto curto (as mensagens novas, quem está
 * aqui...), para gastar pouco. O Chrome abre com janela (sem janela ele não
 * captura a tela do Mac) e fica minimizado.
 *
 *   SALA_SITE  endereço do app (padrão: https://tom4te-rooms.vercel.app)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { chromium } from "playwright";

const SITE = (process.env.SALA_SITE || "https://tom4te-rooms.vercel.app").replace(/\/$/, "");
const JOIN_TIMEOUT_MS = 25000;

// browser: o Chrome aberto; window: a janela que ele compartilha (fica
// na linha de comando do Chrome: trocar a janela = abrir de novo).
const state = { browser: null, page: null, room: null, name: null, window: null, errors: [] };

const text = value => ({ content: [{ type: "text", text: value }] });

async function closeBrowser() {
  const browser = state.browser;
  state.browser = state.page = null;
  await browser?.close().catch(() => {});
}

async function openBrowser(windowTitle) {

  await closeBrowser();

  const args = [
    "--use-fake-ui-for-media-stream",          // aceita os pedidos de microfone/tela sozinho
    "--disable-background-timer-throttling",   // minimizado, continua trabalhando
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1280,800"
  ];

  // Compartilhar tela: o Chrome escolhe sozinho a janela com este título.
  if (windowTitle) args.push(`--auto-select-desktop-capture-source=${windowTitle}`);

  state.browser = await chromium.launch({ channel: "chrome", headless: false, args });
  state.window = windowTitle || null;

  const context = await state.browser.newContext({ viewport: { width: 1280, height: 760 } });
  state.page = await context.newPage();
  state.errors = [];

  state.page.on("pageerror", error => {
    state.errors.push(error.message);
    if (state.errors.length > 5) state.errors.shift();
  });

  state.browser.on("disconnected", () => { state.browser = state.page = null; });

}

async function minimize() {
  try {
    const session = await state.page.context().newCDPSession(state.page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
  } catch {}
}

async function join(room, name, windowTitle) {

  await openBrowser(windowTitle);

  const page = state.page;

  // O nome vai antes da página abrir (é o que ela lê ao carregar).
  await page.addInitScript(value => {
    try { localStorage.setItem("rtc.deviceName", value); } catch {}
  }, name);

  await page.goto(`${SITE}/${encodeURIComponent(room)}`);

  // Na sala (sessão aberta) ou esperando alguém aceitar (sala privada).
  await page.waitForFunction(() =>
    !document.getElementById("sessionView")?.classList.contains("hidden") ||
    !document.getElementById("pendingModal")?.classList.contains("hidden"),
  null, { timeout: JOIN_TIMEOUT_MS });

  state.room = room;
  state.name = name;

  await page.waitForTimeout(2500); // presença e histórico chegando
  await minimize();

}

function needRoom() {
  if (!state.page || !state.room) throw new Error("Fora da sala: use sala_entrar primeiro.");
  return state.page;
}

// Estado curto: título do topo e quem está aqui (com mic/som/tela).
function snapshot(page) {
  return page.evaluate(() => {
    const pending = !document.getElementById("pendingModal")?.classList.contains("hidden");
    const title = `${document.getElementById("sessionTitle")?.textContent || ""} ${document.getElementById("sessionTitleNote")?.textContent || ""}`.trim();
    const people = [...document.querySelectorAll("#peerList .avatar")].map(avatar =>
      (avatar.getAttribute("title") || avatar.dataset.tipTitle || "").split("\n").slice(0, 2).join(" — "));
    const sharing = document.getElementById("screenBtn")?.classList.contains("on");
    return { pending, pendingText: pending ? document.getElementById("pendingStatus")?.textContent : "", title, people, sharing };
  });
}

// Mensagens ainda não lidas (marca cada uma: o histórico chega fora de ordem).
function unreadMessages(page, max) {
  return page.evaluate(limit => {
    const lines = [];
    for (const element of document.querySelectorAll("#chatList > *")) {
      if (element.dataset.mcpSeen) continue;
      element.dataset.mcpSeen = "1";
      if (element.matches(".msg")) {
        const who = element.querySelector(".who")?.textContent || (element.matches(".mine") ? "eu" : "");
        const time = element.querySelector("time")?.textContent || "";
        const clone = element.cloneNode(true);
        clone.querySelectorAll(".who, time").forEach(node => node.remove());
        lines.push(`${time} ${who}: ${clone.innerText.replace(/\s+/g, " ").trim()}`);
      } else {
        const note = element.innerText.replace(/\s+/g, " ").trim();
        if (note) lines.push(`· ${note}`);
      }
    }
    return lines.length > limit ? [`(${lines.length - limit} mais antigas omitidas)`, ...lines.slice(-limit)] : lines;
  }, max);
}

const server = new McpServer({ name: "sala", version: "1.0.0" });

server.registerTool("sala_entrar", {
  description: "Entra numa sala do app (abre o app num Chrome minimizado) como uma pessoa com o nome dado. Devolve quem está lá.",
  inputSchema: {
    sala: z.string().describe("Nome da sala (o que vem depois do / no endereço)"),
    nome: z.string().optional().describe("Meu nome na sala (padrão: Claude)"),
    janela: z.string().optional().describe("Título da janela que sala_compartilhar_tela vai mostrar (padrão: Terminal)")
  }
}, async ({ sala, nome = "Claude", janela = "Terminal" }) => {
  await join(sala, nome, janela);
  const now = await snapshot(state.page);
  return text(now.pending
    ? `Pedindo para entrar em "${sala}" (sala privada): ${now.pendingText}`
    : `Na sala "${sala}" como ${nome}. ${now.title}\nPessoas:\n- ${now.people.join("\n- ")}`);
});

server.registerTool("sala_mensagens", {
  description: "Mensagens do chat que eu ainda não li (a primeira chamada traz o histórico). Uma por linha: hora, nome, texto.",
  inputSchema: { max: z.number().int().min(1).max(200).optional().describe("No máximo quantas (padrão 30, as mais recentes)") }
}, async ({ max = 30 }) => {
  const lines = await unreadMessages(needRoom(), max);
  const errors = state.errors.length ? `\n(erros na página: ${state.errors.join(" | ")})` : "";
  return text((lines.length ? lines.join("\n") : "(nada novo)") + errors);
});

server.registerTool("sala_enviar", {
  description: "Manda uma mensagem no chat da sala.",
  inputSchema: { texto: z.string().min(1).max(2000) }
}, async ({ texto }) => {
  const page = needRoom();
  const before = await page.evaluate(() => document.querySelectorAll("#chatList > .msg.mine").length);
  await page.fill("#chatInput", texto);
  await page.press("#chatInput", "Enter");
  const sent = await page.waitForFunction(count => document.querySelectorAll("#chatList > .msg.mine").length > count, before, { timeout: 3000 })
    .then(() => true, () => false);
  // A minha já conta como lida.
  await page.evaluate(() => document.querySelectorAll("#chatList > .msg.mine").forEach(element => { element.dataset.mcpSeen = "1"; }));
  return text(sent ? "Enviado." : "Não apareceu no chat (a mensagem pode não ter saído).");
});

server.registerTool("sala_pessoas", {
  description: "Quem está na sala agora (com microfone, som e o que compartilha) e o estado da conexão.",
  inputSchema: {}
}, async () => {
  const now = await snapshot(needRoom());
  return text(`${now.title}${now.sharing ? " · eu compartilhando a tela" : ""}\n- ${now.people.join("\n- ")}`);
});

server.registerTool("sala_compartilhar_tela", {
  description: "Compartilha na sala uma janela do Mac (padrão: a do Terminal) ou para de compartilhar. Trocar de janela faz entrar na sala de novo.",
  inputSchema: {
    janela: z.string().optional().describe("Título (ou parte) da janela a mostrar"),
    parar: z.boolean().optional().describe("true: para de compartilhar")
  }
}, async ({ janela, parar = false }) => {

  needRoom();

  const sharing = () => state.page.evaluate(() => document.getElementById("screenBtn")?.classList.contains("on"));

  if (parar) {
    if (await sharing()) await state.page.click("#screenBtn");
    return text("Parei de compartilhar.");
  }

  if (janela && janela !== state.window) await join(state.room, state.name, janela);
  if (await sharing()) return text(`Já estou compartilhando "${state.window}".`);

  await state.page.click("#screenBtn");
  await state.page.waitForTimeout(2500);

  if (await sharing()) return text(`Compartilhando a janela "${state.window}".`);

  return text(`Não consegui compartilhar "${state.window}". No Mac, o Chrome precisa de permissão em Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela (depois feche e abra de novo). Confira também se existe uma janela com esse título.` +
    (state.errors.length ? `\nErros na página: ${state.errors.join(" | ")}` : ""));

});

server.registerTool("sala_sair", {
  description: "Sai da sala e fecha o Chrome.",
  inputSchema: {}
}, async () => {
  await closeBrowser();
  state.room = null;
  return text("Saí da sala.");
});

const shutdown = () => closeBrowser().finally(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
