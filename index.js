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
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= PAINEL ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

let mensagemPainelId = null;

/* ================= HELPERS ================= */

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

async function responderTemp(interaction, texto, tempo = 5000) {
  if (interaction.replied || interaction.deferred) return;

  const msg = await interaction.reply({
    content: texto,
    fetchReply: true,
    ephemeral: true
  });

  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, tempo);
}

/* ================= RELATÓRIO PAINEL ================= */

let mensagemRelatorioId = null;
const logsRelatorio = [];

async function enviarRelatorio(acao, detalhes) {
  const canal = await client.channels.fetch(CANAL_RELATORIO_ID);

  logsRelatorio.push(
    `[${horarioBrasilia()}] ${acao} — ${detalhes}`
  );

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

/* ================= ATUALIZAR PAINEL ================= */

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

/* ================= TICKETS ================= */

const ticketsAbertos = new Map();

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

    /* ========= PAINEL ========= */

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel])
        return responderTemp(interaction, '⚠️ Telefone ocupado.');

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      atendimentosAtivos.set(interaction.user.id, [
        ...(atendimentosAtivos.get(interaction.user.id) || []),
        tel
      ]);

      await atualizarPainel();
      await enviarRelatorio('📞 Conectou', `${interaction.user.username} → ${tel}`);

      return responderTemp(interaction, `📞 Conectado ao **${tel}**`);
    }

    if (interaction.isButton() && interaction.customId === 'sair_todos') {

      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      lista.forEach(t => {
        delete estadoTelefones[t];
        enviarRelatorio('📴 Saiu', `${interaction.user.username} → ${t}`);
      });

      atendimentosAtivos.delete(interaction.user.id);

      await atualizarPainel();

      return responderTemp(interaction, '📴 Desconectado de todos');
    }

    /* ========= TICKET ========= */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {

      if (ticketsAbertos.has(interaction.user.id))
        return responderTemp(interaction, '⚠️ Você já possui ticket.');

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
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

      return responderTemp(interaction, `✅ Ticket criado: ${canal}`);
    }

    if (interaction.isButton() && interaction.channel.parentId === CATEGORIA_TICKET_ID) {

      await interaction.deferUpdate();

      const donoId = [...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id)?.[0];

      const isStaff = interaction.member.roles.cache.has(CARGO_STAFF_ID);

      if (interaction.customId === 'ticket_fechar') {

        await interaction.channel.setName(interaction.channel.name.replace('-aberto', '-fechado'));

        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false });
      }

      if (interaction.customId === 'ticket_abrir' && isStaff) {

        await interaction.channel.setName(interaction.channel.name.replace('-fechado', '-aberto'));

        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true });
      }

      if (interaction.customId === 'ticket_excluir' && isStaff) {

        ticketsAbertos.delete(donoId);
        await interaction.channel.delete();
      }

      if (
        interaction.customId === 'ticket_salvar' &&
        interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
      ) {

        const msgs = await interaction.channel.messages.fetch({ limit: 100 });

        const texto = msgs
          .reverse()
          .map(m => `[${m.author.username}] ${m.content}`)
          .join('\n');

        const dono = await interaction.guild.members.fetch(donoId);

        const data = horarioBrasilia();

        await dono.send(
          `📋 **Resumo do Ticket**\n👤 ${dono}\n📅 ${data}\n\n${texto}`
        );

        const transcript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);

        await transcript.send(
          `📁 **Ticket salvo**\n👤 ${dono.user.username}\n📅 ${data}\n\n${texto}`
        );

        ticketsAbertos.delete(donoId);

        await interaction.channel.delete();
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
