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
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= PAINEL ================= */

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();

let mensagemPainelId = null;

/* ================= FUNÇÃO PAINEL ================= */

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
  for (let i = 0; i < botoes.length; i += 5)
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));

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

/* ================= HELPERS ================= */

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

/* ================= TICKETS ================= */

const ticketsAbertos = new Map();

/* ================= BOTÕES TICKET ================= */

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

    /* ================= PAINEL ENTRAR ================= */

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[tel])
        return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username
      };

      await atualizarPainel();

      return interaction.reply({
        content: `📞 Conectado ao **${tel}**`,
        ephemeral: true
      });
    }

    /* ================= PAINEL BOTÕES ================= */

    if (interaction.isButton()) {

      if (interaction.customId === 'sair_todos') {
        await interaction.deferReply({ ephemeral: true });

        for (const tel of Object.keys(estadoTelefones))
          delete estadoTelefones[tel];

        await atualizarPainel();

        return interaction.editReply('🔴 Todos desconectados.');
      }

      if (interaction.customId === 'menu_sair') {
        const ocupados = telefones.filter(t => estadoTelefones[t]);

        if (!ocupados.length)
          return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

        return interaction.reply({
          ephemeral: true,
          content: '📞 Selecione:',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('select_sair')
                .addOptions(ocupados.map(t => ({ label: t, value: t })))
            )
          ]
        });
      }

      if (interaction.customId === 'menu_transferir') {
        const ocupados = telefones.filter(t => estadoTelefones[t]);

        if (!ocupados.length)
          return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

        return interaction.reply({
          ephemeral: true,
          content: '📞 Selecione:',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('select_transferir_tel')
                .addOptions(ocupados.map(t => ({ label: t, value: t })))
            )
          ]
        });
      }

      if (interaction.customId === 'menu_forcar') {
        const ocupados = telefones.filter(t => estadoTelefones[t]);

        if (!ocupados.length)
          return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

        return interaction.reply({
          ephemeral: true,
          content: '⚠️ Selecione:',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('select_forcar')
                .addOptions(ocupados.map(t => ({ label: t, value: t })))
            )
          ]
        });
      }
    }

    /* ================= SELECT PAINEL ================= */

    if (interaction.isStringSelectMenu()) {

      if (interaction.customId === 'select_sair') {
        delete estadoTelefones[interaction.values[0]];
        await atualizarPainel();

        return interaction.update({
          content: '🟠 Desconectado.',
          components: []
        });
      }

      if (interaction.customId === 'select_transferir_tel') {
        telefoneSelecionado.set(interaction.user.id, interaction.values[0]);

        return interaction.update({
          content: '👤 Escolha usuário:',
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder().setCustomId('select_transferir_user')
            )
          ]
        });
      }

      if (interaction.customId === 'select_forcar') {
        delete estadoTelefones[interaction.values[0]];
        await atualizarPainel();

        return interaction.update({
          content: '⚠️ Forçado.',
          components: []
        });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'select_transferir_user') {
      const tel = telefoneSelecionado.get(interaction.user.id);
      const userId = interaction.values[0];

      const membro = await interaction.guild.members.fetch(userId);

      estadoTelefones[tel] = {
        userId,
        nome: membro.user.username
      };

      telefoneSelecionado.delete(interaction.user.id);

      await atualizarPainel();

      return interaction.update({
        content: '🔵 Transferido.',
        components: []
      });
    }

    /* ================= TICKETS ================= */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {

      if (ticketsAbertos.has(interaction.user.id))
        return interaction.reply({ content: '⚠️ Você já tem ticket.', ephemeral: true });

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

      return interaction.reply({
        content: `✅ Ticket criado: ${canal}`,
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.channel.parentId === CATEGORIA_TICKET_ID) {

      const donoId = [...ticketsAbertos.entries()].find(e => e[1] === interaction.channel.id)?.[0];

      const isStaff = interaction.member.roles.cache.has(CARGO_STAFF_ID);

      if (interaction.customId === 'ticket_fechar' && donoId) {
        await interaction.channel.setName(interaction.channel.name.replace('-aberto', '-fechado'));
        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: false });

        return interaction.reply({ content: '🔴 Ticket fechado.', ephemeral: true });
      }

      if (interaction.customId === 'ticket_abrir' && isStaff && donoId) {
        await interaction.channel.setName(interaction.channel.name.replace('-fechado', '-aberto'));
        await interaction.channel.permissionOverwrites.edit(donoId, { SendMessages: true });

        return interaction.reply({ content: '🟢 Ticket reaberto.', ephemeral: true });
      }

      if (interaction.customId === 'ticket_excluir' && isStaff) {
        if (donoId) ticketsAbertos.delete(donoId);
        return interaction.channel.delete();
      }

      if (
        interaction.customId === 'ticket_salvar' &&
        interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)
      ) {

        const msgs = await interaction.channel.messages.fetch({ limit: 100 });

        const texto = msgs
          .reverse()
          .map(m => `[${m.createdAt.toLocaleString('pt-BR')}] ${m.author.username}: ${m.content}`)
          .join('\n');

        const dono = await interaction.guild.members.fetch(donoId);

        await dono.send({
          content: `📋 **Resumo do Ticket — ${horarioBrasilia()}**\n\n${dono}\n\n${texto}`
        });

        const transcript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);

        await transcript.send({
          content: `📁 **Ticket salvo — ${dono.user.username} — ${horarioBrasilia()}**\n\n${texto}`
        });

        ticketsAbertos.delete(donoId);

        return interaction.channel.delete();
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
