require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const http = require('http');

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_RELATORIO_ID = '1458342162981716039';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ================= HELPERS ================= */

async function responderTemp(interaction, texto, tempo = 5000) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  const msg = await interaction.editReply({ content: texto });

  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, tempo);
}

/* ================= PAINEL ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();

let mensagemPainelId = null;

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones
    .map(t =>
      estadoTelefones[t]
        ? `🔴 ${t} — ${estadoTelefones[t].nome}`
        : `🟢 ${t} — Livre`
    )
    .join('\n');

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

/* ================= RELATÓRIO ================= */

let mensagemRelatorioId = null;
const logsRelatorio = [];

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

async function enviarRelatorio(acao, detalhes) {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);

  logsRelatorio.push(`[${horarioBrasilia()}] ${acao} — ${detalhes}`);

  const texto = `📋 **RELATÓRIO DO PAINEL**\n\n${logsRelatorio.slice(-25).join('\n')}`;

  if (mensagemRelatorioId) {
    try {
      const msg = await canal.messages.fetch(mensagemRelatorioId);
      return msg.edit({ content: texto });
    } catch {
      mensagemRelatorioId = null;
    }
  }

  const msg = await canal.send(texto);
  mensagemRelatorioId = msg.id;
}

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ========= CONECTAR ========= */

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel])
        return responderTemp(interaction, '⚠️ Telefone ocupado.');

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      await atualizarPainel();
      await enviarRelatorio('📞 Conexão', `${interaction.user.username} → ${tel}`);

      return responderTemp(interaction, `📞 Conectado ao **${tel}**`);
    }

    /* ========= DESCONECTAR TODOS ========= */

    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      for (const tel in estadoTelefones) delete estadoTelefones[tel];

      await atualizarPainel();
      await enviarRelatorio('🔴 Forçado geral', interaction.user.username);

      return responderTemp(interaction, '🔴 Todos desconectados.');
    }

    /* ========= MENU UM ========= */

    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const menu = new StringSelectMenuBuilder()
        .setCustomId('select_sair')
        .setPlaceholder('Escolha o telefone')
        .addOptions(
          telefones
            .filter(t => estadoTelefones[t])
            .map(t => ({
              label: t,
              value: t
            }))
        );

      await interaction.reply({
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_sair') {
      const tel = interaction.values[0];
      const user = estadoTelefones[tel];

      delete estadoTelefones[tel];

      await atualizarPainel();
      await enviarRelatorio('🟠 Desconectado', `${user.nome} ← ${tel}`);

      await interaction.update({ components: [] });
    }

  } catch (err) {
    console.error('❌ ERRO INTERAÇÃO:', err);
  }
});

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
});

/* ================= LOGIN ================= */

client.login(TOKEN);

/* ================= HTTP ================= */

http.createServer((_, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
