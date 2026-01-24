// ====== MANTIVE TUDO DO PAINEL / RELATÓRIO ======

require('dotenv').config();
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

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CANAL_RELATORIO_ID = '1458342162981716039';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ================= PAINEL ================= */
// >>>>> NÃO TOQUEI <<<<<

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

let mensagemPainelId = null;

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

  const texto = `📋 **RELATÓRIO DO PAINEL**\n\n${logsRelatorio.join('\n')}`;

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

/* ================= TICKETS ================= */

const ticketsAbertos = new Map();

/* ================= HELPERS ================= */

async function responderTemp(interaction, texto, tempo = 5000) {
  if (interaction.replied || interaction.deferred) return;

  const msg = await interaction.reply({
    content: texto,
    fetchReply: true
  });

  setTimeout(() => {
    msg.delete().catch(() => {});
  }, tempo);
}

/* ================= BOTÕES DO TICKET ================= */

function botoesTicket() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_abrir').setLabel('🟢 Abrir').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔴 Fechar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑️ Excluir').setStyle(ButtonStyle.Danger)
  );
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');

  await atualizarPainel();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);

  await canalTicket.send({
    content: '🎫 **ATENDIMENTO**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('📂 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ================= TICKET ABERTURA ================= */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {

      if (ticketsAbertos.has(interaction.user.id))
        return responderTemp(interaction, '⚠️ Você já possui ticket.');

      await interaction.deferReply({ ephemeral: true });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);

      await canal.send({
        content: '🎫 Ticket iniciado.',
        components: [botoesTicket()]
      });

      await interaction.editReply({ content: `✅ Ticket criado: ${canal}` });

      setTimeout(() => interaction.deleteReply().catch(() => {}), 7000);
    }

    /* ================= BOTÕES DENTRO DO TICKET ================= */

    if (interaction.isButton() && interaction.channel.parentId === CATEGORIA_TICKET_ID) {

      const membro = interaction.member;

      const isStaff = membro.roles.cache.has(CARGO_STAFF_ID);

      // ===== FECHAR =====
      if (interaction.customId === 'ticket_fechar') {

        await interaction.channel.permissionOverwrites.edit(
          ticketsAbertos.get([...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id)?.[0]),
          { SendMessages: false }
        );

        return responderTemp(interaction, '🔴 Ticket fechado.');
      }

      // ===== ABRIR =====
      if (interaction.customId === 'ticket_abrir') {

        if (!isStaff)
          return responderTemp(interaction, '⚠️ Apenas staff.');

        const dono = [...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id)?.[0];

        await interaction.channel.permissionOverwrites.edit(dono, { SendMessages: true });

        return responderTemp(interaction, '🟢 Ticket reaberto.');
      }

      // ===== EXCLUIR =====
      if (interaction.customId === 'ticket_excluir') {

        if (!isStaff)
          return responderTemp(interaction, '⚠️ Apenas staff.');

        ticketsAbertos.forEach((v, k) => {
          if (v === interaction.channel.id) ticketsAbertos.delete(k);
        });

        return interaction.channel.delete();
      }

      // ===== SALVAR =====
      if (interaction.customId === 'ticket_salvar') {

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
          return responderTemp(interaction, '⚠️ Apenas admin.');

        const msgs = await interaction.channel.messages.fetch({ limit: 100 });
        const texto = msgs
          .reverse()
          .map(m => `[${m.author.username}] ${m.content}`)
          .join('\n');

        const donoId = [...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id)?.[0];
        const dono = await interaction.guild.members.fetch(donoId);

        await dono.send(`📋 **Resumo do Ticket**\n\n${texto}`);

        const canalRelatorio = await client.channels.fetch(CANAL_RELATORIO_ID);
        await canalRelatorio.send(`📁 **Ticket salvo**\n\n${texto}`);

        return responderTemp(interaction, '💾 Ticket salvo e enviado.');
      }
    }

  } catch (err) {
    console.error('❌ ERRO INTERAÇÃO:', err);
  }
});

/* ================= LOGIN ================= */

client.login(TOKEN);

/* ================= HTTP ================= */

http.createServer((_, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
