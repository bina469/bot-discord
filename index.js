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

/* ================= ESTADO ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

const ticketsAbertos = new Map();

let mensagemPainelId = null;
let mensagemRelatorioId = null;

const logsRelatorio = [];

/* ================= HELPERS ================= */

async function responderTemp(interaction, texto, tempo = 5000) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  await interaction.editReply({ content: texto });

  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, tempo);
}

/* ================= RELATÓRIO ================= */

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
      return msg.edit(texto);
    } catch {
      mensagemRelatorioId = null;
    }
  }

  const msg = await canal.send(texto);
  mensagemRelatorioId = msg.id;
}

/* ================= PAINEL ================= */

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones
    .map(t =>
      estadoTelefones[t]
        ? `🔴 ${t} — ${estadoTelefones[t].nome}`
        : `🟢 ${t} — Livre`
    )
    .join('\n');

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      telefones.map(t =>
        new ButtonBuilder()
          .setCustomId(`entrar_${t}`)
          .setLabel(`📞 ${t}`)
          .setStyle(ButtonStyle.Success)
      )
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sair_todos')
        .setLabel('🔴 Desconectar TODOS')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('menu_sair')
        .setLabel('🟠 Desconectar UM')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('menu_transferir')
        .setLabel('🔵 Transferir')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('menu_forcar')
        .setLabel('⚠️ Forçar')
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  if (mensagemPainelId) {
    try {
      const msg = await canal.messages.fetch(mensagemPainelId);
      return msg.edit({ content: texto, components: rows });
    } catch {
      mensagemPainelId = null;
    }
  }

  const msgs = await canal.messages.fetch({ limit: 20 });
  const antiga = msgs.find(m => m.author.id === client.user.id);

  if (antiga) {
    mensagemPainelId = antiga.id;
    return antiga.edit({ content: texto, components: rows });
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
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
          .setLabel('📂 Abrir Ticket')
          .setStyle(ButtonStyle.Primary)
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

      return responderTemp(interaction, `📞 Conectado ao ${tel}`);
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      lista.forEach(t => delete estadoTelefones[t]);
      atendimentosAtivos.delete(interaction.user.id);

      await atualizarPainel();

      return responderTemp(interaction, '📴 Desconectado de todos');
    }

    /* ===== MENUS ===== */

    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];

      if (!lista.length)
        return responderTemp(interaction, '⚠️ Nenhum telefone seu.');

      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('sair_um')
              .setPlaceholder('Selecione')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ]
      });
    }

    if (interaction.isButton() && interaction.customId === 'menu_forcar') {
      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('forcar_tel')
              .setPlaceholder('Selecione')
              .addOptions(
                Object.keys(estadoTelefones).map(t => ({
                  label: `${t} — ${estadoTelefones[t].nome}`,
                  value: t
                }))
              )
          )
        ]
      });
    }

    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      return interaction.reply({
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('transferir_tel')
              .setPlaceholder('Selecione')
              .addOptions(
                Object.keys(estadoTelefones).map(t => ({
                  label: `${t} — ${estadoTelefones[t].nome}`,
                  value: t
                }))
              )
          )
        ]
      });
    }

    /* ===== SELECT ===== */

    if (interaction.isStringSelectMenu()) {

      if (interaction.customId === 'sair_um') {
        const tel = interaction.values[0];

        delete estadoTelefones[tel];

        atendimentosAtivos.set(
          interaction.user.id,
          (atendimentosAtivos.get(interaction.user.id) || []).filter(
            t => t !== tel
          )
        );

        await atualizarPainel();

        return interaction.update({ content: `📴 Saiu do ${tel}`, components: [] });
      }

      if (interaction.customId === 'forcar_tel') {
        const tel = interaction.values[0];

        delete estadoTelefones[tel];

        await atualizarPainel();

        return interaction.update({
          content: `⚠️ ${tel} forçado`,
          components: []
        });
      }

      if (interaction.customId === 'transferir_tel') {
        telefoneSelecionado.set(interaction.user.id, interaction.values[0]);

        return interaction.update({
          content: 'Escolha usuário:',
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder().setCustomId('transferir_user')
            )
          ]
        });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'transferir_user') {
      const tel = telefoneSelecionado.get(interaction.user.id);

      const novoUserId = interaction.values[0];
      const membro = await interaction.guild.members.fetch(novoUserId);

      estadoTelefones[tel] = {
        userId: novoUserId,
        nome: membro.user.username
      };

      telefoneSelecionado.delete(interaction.user.id);

      await atualizarPainel();

      return interaction.update({
        content: `🔁 ${tel} transferido`,
        components: []
      });
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
