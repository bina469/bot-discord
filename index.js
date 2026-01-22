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

/* ================= RELATÓRIO ================= */
let mensagemRelatorioId = null;
const relatorioDiario = [];
const tempoAtivoTelefone = {};
const tempoTotalUsuario = {};

/* ===== TIMEZONE BR ===== */
function getHoraBR() {
  return new Date().toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo'
  });
}

function getDataHoje() {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo'
  });
}

function registrarLog(acao, usuario, telefone) {
  relatorioDiario.push({
    hora: getHoraBR(),
    usuario,
    telefone,
    acao
  });
}

/* ================= RELATÓRIO RENDER ================= */
async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);

  const logs = relatorioDiario.map(
    l => `🕒 ${l.hora} | **${l.usuario}** | ${l.telefone} → ${l.acao}`
  ).join('\n') || 'Nenhuma atividade registrada hoje.';

  const tempos = Object.entries(tempoTotalUsuario).map(
    ([user, ms]) => `👤 **${user}** — ${(ms / 60000).toFixed(1)} min`
  ).join('\n') || 'Sem tempo registrado.';

  const texto =
`📊 **RELATÓRIO DIÁRIO — ${getDataHoje()}**

**🧾 Logs do Painel**
${logs}

**⏱️ Tempo Total por Usuário**
${tempos}`;

  if (mensagemRelatorioId) {
    try {
      const msg = await canal.messages.fetch(mensagemRelatorioId);
      return msg.edit({ content: texto });
    } catch {
      mensagemRelatorioId = null;
    }
  }

  const msg = await canal.send({ content: texto });
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

  const botoesTelefone = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTelefone.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Secondary)
    )
  );

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
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== ENTRAR TELEFONE ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel]) {
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
      }

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      if (!atendimentosAtivos.has(interaction.user.id)) {
        atendimentosAtivos.set(interaction.user.id, []);
      }

      atendimentosAtivos.get(interaction.user.id).push(tel);

      tempoAtivoTelefone[tel] = Date.now();
      registrarLog('Entrou', interaction.user.username, tel);

      await atualizarPainel();
      await atualizarRelatorio();

      return interaction.reply({ content: `📞 Conectado ao ${tel}`, ephemeral: true });
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      for (const tel of lista) {
        const duracao = Date.now() - tempoAtivoTelefone[tel];

        tempoTotalUsuario[interaction.user.username] =
          (tempoTotalUsuario[interaction.user.username] || 0) + duracao;

        registrarLog('Saiu', interaction.user.username, tel);

        delete estadoTelefones[tel];
        delete tempoAtivoTelefone[tel];
      }

      atendimentosAtivos.delete(interaction.user.id);

      await atualizarPainel();
      await atualizarRelatorio();

      return interaction.reply({ content: '📴 Desconectado de todos', ephemeral: true });
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
