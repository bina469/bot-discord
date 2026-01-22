const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const http = require('http');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CATEGORIA_TICKET_ID = '1463703325034676334';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();
let mensagemPainelId = null;

/* ================= TICKETS ================= */
const ticketsAbertos = new Map();

/* ================= RELATÓRIO ================= */
let mensagemRelatorioId = null;
let dataRelatorio = new Date().toLocaleDateString('pt-BR');

const logs = [];
const tempoInicioTelefone = {};
const tempoTotalUsuario = {};

function agora() {
  return new Date().toLocaleTimeString('pt-BR');
}

function registrar(acao, user, tel, duracaoMs = 0) {
  logs.push({
    hora: agora(),
    user,
    tel,
    acao,
    duracao: duracaoMs
  });

  if (duracaoMs > 0) {
    tempoTotalUsuario[user] = (tempoTotalUsuario[user] || 0) + duracaoMs;
  }
}

async function atualizarRelatorio() {
  const hoje = new Date().toLocaleDateString('pt-BR');
  if (hoje !== dataRelatorio) {
    dataRelatorio = hoje;
    logs.length = 0;
    for (const k in tempoTotalUsuario) delete tempoTotalUsuario[k];
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

  if (mensagemRelatorioId) {
    try {
      const msg = await canal.messages.fetch(mensagemRelatorioId);
      return msg.edit({ content: conteudo });
    } catch {
      mensagemRelatorioId = null;
    }
  }

  const msg = await canal.send({ content: conteudo });
  mensagemRelatorioId = msg.id;
}

/* ================= PAINEL RENDER ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const botoes = telefones.map(t =>
    new ButtonBuilder().setCustomId(`entrar_${t}`).setLabel(`📞 ${t}`).setStyle(ButtonStyle.Success)
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

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    try {
      const msg = await canal.messages.fetch(mensagemPainelId);
      return msg.edit({ content: texto, components: rows });
    } catch {
      mensagemPainelId = null;
    }
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
  await atualizarRelatorio();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);
  await canalTicket.send({
    content: '🎫 **ATENDIMENTO**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('abrir_ticket').setLabel('📂 Iniciar Atendimento').setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== ENTRAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel]) return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = { userId: interaction.user.id, nome: interaction.user.username };
      tempoInicioTelefone[tel] = Date.now();

      if (!atendimentosAtivos.has(interaction.user.id)) atendimentosAtivos.set(interaction.user.id, []);
      atendimentosAtivos.get(interaction.user.id).push(tel);

      registrar('Entrou', interaction.user.username, tel);
      await atualizarPainel();
      await atualizarRelatorio();
      return interaction.reply({ content: `📞 Conectado ao **${tel}**`, ephemeral: true });
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) {
        const dur = Date.now() - tempoInicioTelefone[tel];
        registrar('Saiu', interaction.user.username, tel, dur);
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
      const dur = Date.now() - tempoInicioTelefone[tel];

      registrar('Forçado', info.nome, tel, dur);

      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        info.userId,
        (atendimentosAtivos.get(info.userId) || []).filter(t => t !== tel)
      );

      await atualizarPainel();
      await atualizarRelatorio();
      return interaction.update({ content: `⚠️ ${tel} desconectado à força.`, components: [] });
    }

    /* ===== TRANSFERIR FINAL ===== */
    if (interaction.isUserSelectMenu() && interaction.customId === 'transferir_user') {
      const tel = telefoneSelecionado.get(interaction.user.id);
      const antigo = estadoTelefones[tel];
      const dur = Date.now() - tempoInicioTelefone[tel];

      registrar('Transferiu', antigo.nome, tel, dur);

      estadoTelefones[tel] = {
        userId: interaction.values[0],
        nome: interaction.guild.members.cache.get(interaction.values[0])?.user.username || 'Usuário'
      };

      tempoInicioTelefone[tel] = Date.now();
      await atualizarPainel();
      await atualizarRelatorio();
      return interaction.update({ content: `🔁 ${tel} transferido.`, components: [] });
    }

  } catch (err) {
    console.error(err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
