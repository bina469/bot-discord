const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');

const http = require('http');

/* ================= ENV ================= */
const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

/* ================= IDS ================= */
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_RELATORIO_ID = '1458342162981716039';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ================= ESTADO (ZERA SEMPRE) ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

let estadoTelefones = {};
let atendimentosAtivos = new Map();
let telefoneSelecionado = new Map();

let mensagemPainelId = null;
let mensagemRelatorioId = null;

/* ================= RELATÓRIO ================= */
let logs = [];
let tempoInicioTelefone = {};
let tempoTotalUsuario = {};
let dataRelatorio = new Date().toLocaleDateString('pt-BR');

function agora() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo'
  });
}

function registrar(acao, user, tel, duracaoMs = 0) {
  logs.push({ hora: agora(), user, tel, acao, duracao: duracaoMs });
  if (duracaoMs > 0) {
    tempoTotalUsuario[user] = (tempoTotalUsuario[user] || 0) + duracaoMs;
  }
}

/* ================= LIMPEZA DE CANAL ================= */
async function limparMensagensBot(canalId) {
  const canal = await client.channels.fetch(canalId);
  const msgs = await canal.messages.fetch({ limit: 50 });
  const minhas = msgs.filter(m => m.author.id === client.user.id);
  for (const msg of minhas.values()) {
    await msg.delete().catch(() => {});
  }
}

/* ================= RELATÓRIO ================= */
async function atualizarRelatorio() {
  const hoje = new Date().toLocaleDateString('pt-BR');
  if (hoje !== dataRelatorio) {
    dataRelatorio = hoje;
    logs = [];
    tempoTotalUsuario = {};
    mensagemRelatorioId = null;
  }

  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);

  const textoLogs = logs.map(l =>
    `🕒 ${l.hora} | **${l.user}** | ☎️ ${l.tel} → ${l.acao}` +
    (l.duracao ? ` (${(l.duracao / 60000).toFixed(1)} min)` : '')
  ).join('\n') || 'Nenhuma ação registrada hoje.';

  const tempos = Object.entries(tempoTotalUsuario).map(
    ([u, ms]) => `👤 **${u}** — ${(ms / 60000).toFixed(1)} min`
  ).join('\n') || 'Sem tempo computado.';

  const conteudo =
`📊 **RELATÓRIO DIÁRIO — ${dataRelatorio}**

**🧾 Ações do Painel**
${textoLogs}

**⏱️ Tempo Total por Usuário**
${tempos}`;

  const msg = await canal.send({ content: conteudo });
  mensagemRelatorioId = msg.id;
}

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const botoes = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoes.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Secondary)
  ));

  const msg = await canal.send({
    content: `📞 **PAINEL DE PRESENÇA**\n\n${status}`,
    components: rows
  });

  mensagemPainelId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log('✅ Bot online — reset completo');

  // LIMPA TUDO SEM PERGUNTAR
  estadoTelefones = {};
  atendimentosAtivos = new Map();
  telefoneSelecionado = new Map();
  logs = [];
  tempoInicioTelefone = {};
  tempoTotalUsuario = {};
  mensagemPainelId = null;
  mensagemRelatorioId = null;

  await limparMensagensBot(CANAL_PAINEL_PRESENCA_ID);
  await limparMensagensBot(CANAL_RELATORIO_ID);

  await atualizarPainel();
  await atualizarRelatorio();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== ENTRAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel])
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      tempoInicioTelefone[tel] = Date.now();

      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      lista.push(tel);
      atendimentosAtivos.set(interaction.user.id, lista);

      registrar('Entrou', interaction.user.username, tel);
      await atualizarPainel();
      await atualizarRelatorio();
      return interaction.reply({ content: `📞 Conectado ao **${tel}**`, ephemeral: true });
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) {
        registrar('Saiu', interaction.user.username, tel, Date.now() - tempoInicioTelefone[tel]);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainel();
      await atualizarRelatorio();
      return interaction.reply({ content: '📴 Desconectado de todos', ephemeral: true });
    }

    /* ===== FORÇAR ===== */
    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {
      const tel = interaction.values[0];
      const info = estadoTelefones[tel];
      if (!info) return interaction.update({ content: '⚠️ Sessão inexistente.', components: [] });

      registrar('Forçado', info.nome, tel, Date.now() - tempoInicioTelefone[tel]);
      delete estadoTelefones[tel];

      const lista = atendimentosAtivos.get(info.userId) || [];
      atendimentosAtivos.set(info.userId, lista.filter(t => t !== tel));

      await atualizarPainel();
      await atualizarRelatorio();
      return interaction.update({ content: `⚠️ ${tel} desconectado à força.`, components: [] });
    }

  } catch (e) {
    console.error(e);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
