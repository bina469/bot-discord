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
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ================= PAINEL ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
let mensagemPainelId = null;

/* ================= TICKETS ================= */
const ticketsAbertos = new Map();

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
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) return msg.edit({ content: texto, components: rows });
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
          .setLabel('📂 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {

    /* ===== CONECTAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel]) {
        return interaction.reply({ content: '⚠️ Telefone ocupado.', flags: 64 });
      }

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username,
        entrada: new Date()
      };

      if (!atendimentosAtivos.has(interaction.user.id)) {
        atendimentosAtivos.set(interaction.user.id, []);
      }
      atendimentosAtivos.get(interaction.user.id).push(tel);

      await atualizarPainel();
      return interaction.reply({ content: `📞 Conectado ao **${tel}**`, flags: 64 });
    }

    /* ===== TRANSFERIR (CORRIGIDO) ===== */
    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      if (!lista.length) {
        return interaction.reply({ content: '⚠️ Você não está em nenhum telefone.', flags: 64 });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_escolher_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: 64
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_escolher_tel') {
      const tel = interaction.values[0];

      const menuUser = new UserSelectMenuBuilder()
        .setCustomId(`transferir_usuario_${tel}`)
        .setPlaceholder('Escolha o novo telefonista');

      return interaction.update({
        components: [new ActionRowBuilder().addComponents(menuUser)]
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_usuario_')) {
      const tel = interaction.customId.replace('transferir_usuario_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);

      const antigo = estadoTelefones[tel];

      estadoTelefones[tel] = {
        userId: novoId,
        nome: novoUser.username,
        entrada: new Date()
      };

      atendimentosAtivos.set(
        antigo.userId,
        atendimentosAtivos.get(antigo.userId).filter(t => t !== tel)
      );

      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(tel);

      await atualizarPainel();

      return interaction.update({
        content: `🔁 **${tel}** transferido para **${novoUser.username}**`,
        components: []
      });
    }

    /* ===== OUTROS (INALTERADOS) ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainel();
      return interaction.reply({ content: '📴 Desconectado de todos', flags: 64 });
    }

    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum telefone.', flags: 64 });

      return interaction.reply({
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('sair_um')
              .setPlaceholder('Escolha')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ],
        flags: 64
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const tel = interaction.values[0];
      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        interaction.user.id,
        atendimentosAtivos.get(interaction.user.id).filter(t => t !== tel)
      );
      await atualizarPainel();
      return interaction.update({ content: `✅ ${tel} desconectado`, components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'menu_forcar') {
      const lista = Object.keys(estadoTelefones);
      if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum ativo.', flags: 64 });

      return interaction.reply({
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('forcar_tel')
              .setPlaceholder('Forçar')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ],
        flags: 64
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {
      const tel = interaction.values[0];
      const dados = estadoTelefones[tel];
      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        dados.userId,
        atendimentosAtivos.get(dados.userId)?.filter(t => t !== tel) || []
      );
      await atualizarPainel();
      return interaction.update({ content: `⚠️ ${tel} forçado`, components: [] });
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

/* ================= TICKET SYSTEM ================= */

const ticketsAbertos = new Map();

/* ===== BOTÃO ABRIR TICKET ===== */
if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
  await interaction.deferReply({ flags: 64 });

  const member = interaction.member;

  if (!member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
    return interaction.editReply({ content: '❌ Apenas telefonistas podem abrir ticket.' });
  }

  if (ticketsAbertos.has(member.id)) {
    return interaction.editReply({ content: '⚠️ Você já possui um ticket aberto.' });
  }

  const canal = await interaction.guild.channels.create({
    name: `ticket-${member.user.username}-online`,
    type: ChannelType.GuildText,
    parent: CANAL_ABRIR_TICKET_ID,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages
        ]
      },
      {
        id: CARGO_STAFF_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages
        ]
      }
    ]
  });

  ticketsAbertos.set(member.id, canal.id);

  await canal.send({
    content: `🎫 **Ticket de ${member.user.username} — ONLINE**`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_excluir')
          .setLabel('❌ Excluir')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ticket_salvar')
          .setLabel('💾 Salvar')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ticket_reabrir')
          .setLabel('🔓 Reabrir')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  });

  return interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
}

/* ===== EXCLUIR TICKET ===== */
if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
  const canal = interaction.channel;
  const dono = [...ticketsAbertos.entries()].find(([_, c]) => c === canal.id);

  if (!dono || interaction.user.id !== dono[0]) {
    return interaction.reply({ content: '❌ Apenas o dono pode excluir.', flags: 64 });
  }

  ticketsAbertos.delete(dono[0]);
  await canal.delete();
}

/* ===== SALVAR TICKET (STAFF) ===== */
if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
  if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
    return interaction.reply({ content: '❌ Apenas staff.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

  const canal = interaction.channel;
  const dono = [...ticketsAbertos.entries()].find(([_, c]) => c === canal.id);
  if (!dono) return interaction.editReply({ content: 'Erro ao localizar ticket.' });

  const member = await interaction.guild.members.fetch(dono[0]);

  await canal.setParent(CANAL_TRANSCRIPT_ID);
  await canal.setName(`ticket-${member.user.username}-offline`);

  await canal.permissionOverwrites.edit(member.id, {
    SendMessages: false
  });

  ticketsAbertos.delete(dono[0]);

  await member.send(
    `📄 Seu ticket foi salvo.\nCanal: **${canal.name}**`
  ).catch(() => {});

  return interaction.editReply({ content: '💾 Ticket salvo e arquivado.' });
}

/* ===== REABRIR TICKET (STAFF) ===== */
if (interaction.isButton() && interaction.customId === 'ticket_reabrir') {
  if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
    return interaction.reply({ content: '❌ Apenas staff.', flags: 64 });
  }

  const canal = interaction.channel;
  const nome = canal.name.replace('-offline', '-online');

  await canal.setName(nome);

  return interaction.reply({ content: '🔓 Ticket reaberto.', flags: 64 });
}


/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
