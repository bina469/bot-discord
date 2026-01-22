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
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map(); 
let mensagemPainelId = null;

/* ================= RELATÓRIO ================= */
async function enviarRelatorio(acao, detalhes) {
  try {
    const canal = await client.channels.fetch(CANAL_RELATORIO_ID);
    const dataBR = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date());

    let texto = `📋 **RELATÓRIO DO PAINEL**\n[${dataBR}] ${acao}\n${detalhes}`;
    await canal.send(texto);
  } catch (err) {
    console.error('Erro ao enviar relatório:', err);
  }
}

/* ================= TICKETS ================= */
const ticketsAbertos = new Map();

/* ================= PAINEL RENDER ================= */
async function atualizarPainel() {
  try {
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
  } catch (err) {
    console.error('Erro ao atualizar painel:', err);
  }
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
    const replyEphemeral = async (content, delay = 5000) => {
      await interaction.reply({ content, ephemeral: true });
      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, delay);
    };

    /* ===== ENTRAR TELEFONE ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel]) return replyEphemeral('⚠️ Telefone ocupado.');

      estadoTelefones[tel] = { userId: interaction.user.id, nome: interaction.user.username };
      if (!atendimentosAtivos.has(interaction.user.id)) atendimentosAtivos.set(interaction.user.id, []);
      atendimentosAtivos.get(interaction.user.id).push(tel);

      await atualizarPainel();

      await enviarRelatorio('📞 Conexão', `Usuário **${interaction.user.username}** conectou ao telefone **${tel}**`);
      return replyEphemeral(`📞 Conectado ao **${tel}**`);
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) {
        delete estadoTelefones[tel];
        await enviarRelatorio('📴 Desconexão', `Usuário **${interaction.user.username}** desconectado do telefone **${tel}**`);
      }
      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainel();
      return replyEphemeral('📴 Desconectado de todos');
    }

    /* ===== MENUS TEMPORÁRIOS ===== */
    const handleMenu = async (tipo) => {
      const ocupados = Object.keys(estadoTelefones);
      if (!ocupados.length) return replyEphemeral('⚠️ Nenhum telefone em uso.');

      if (tipo === 'sair') {
        const lista = atendimentosAtivos.get(interaction.user.id) || [];
        if (!lista.length) return replyEphemeral('⚠️ Você não está em nenhum telefone.');
        return interaction.reply({
          content: 'Selecione o telefone para sair:',
          ephemeral: true,
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('sair_um')
              .setPlaceholder('Escolha o telefone')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )]
        });
      }

      if (tipo === 'forcar') {
        return interaction.reply({
          content: 'Selecione o telefone para forçar desconexão:',
          ephemeral: true,
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('forcar_tel')
              .setPlaceholder('Escolha o telefone')
              .addOptions(ocupados.map(t => ({ label: `${t} — ${estadoTelefones[t].nome}`, value: t })))
          )]
        });
      }

      if (tipo === 'transferir') {
        return interaction.reply({
          content: 'Selecione o telefone para transferir:',
          ephemeral: true,
          components: [new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('transferir_tel')
              .setPlaceholder('Escolha o telefone')
              .addOptions(ocupados.map(t => ({ label: `${t} — ${estadoTelefones[t].nome}`, value: t })))
          )]
        });
      }
    };

    /* ===== BOTÕES DE MENU ===== */
    if (interaction.isButton()) {
      if (interaction.customId === 'menu_sair') return handleMenu('sair');
      if (interaction.customId === 'menu_forcar') return handleMenu('forcar');
      if (interaction.customId === 'menu_transferir') return handleMenu('transferir');
    }

    /* ===== SELECT MENUS ===== */
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'sair_um') {
        const tel = interaction.values[0];
        delete estadoTelefones[tel];

        const lista = atendimentosAtivos.get(interaction.user.id) || [];
        atendimentosAtivos.set(interaction.user.id, lista.filter(t => t !== tel));

        await atualizarPainel();
        await enviarRelatorio('📴 Desconexão', `Usuário **${interaction.user.username}** desconectou do telefone **${tel}**`);
        return interaction.update({ content: `📴 Saiu do **${tel}**`, components: [] });
      }

      if (interaction.customId === 'forcar_tel') {
        const tel = interaction.values[0];
        const userId = estadoTelefones[tel].userId;
        const nomeUser = estadoTelefones[tel].nome;

        delete estadoTelefones[tel];
        atendimentosAtivos.set(userId, (atendimentosAtivos.get(userId) || []).filter(t => t !== tel));

        await atualizarPainel();
        await enviarRelatorio('⚠️ Forçar Desconexão', `Usuário **${nomeUser}** foi desconectado do telefone **${tel}** à força`);
        return interaction.update({ content: `⚠️ Telefone **${tel}** desconectado à força.`, components: [] });
      }

      if (interaction.customId === 'transferir_tel') {
        const tel = interaction.values[0];
        telefoneSelecionado.set(interaction.user.id, tel);
        const menuUsuario = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId('transferir_user')
            .setPlaceholder('Escolha o usuário')
        );
        return interaction.update({ content: `Telefone **${tel}** selecionado. Agora escolha o usuário:`, components: [menuUsuario] });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'transferir_user') {
      const novoUserId = interaction.values[0];
      const tel = telefoneSelecionado.get(interaction.user.id);
      if (!tel || !estadoTelefones[tel]) return interaction.update({ content: '❌ Telefone inválido.', components: [] });

      const antigoUserId = estadoTelefones[tel].userId;
      const antigoUserNome = estadoTelefones[tel].nome;

      atendimentosAtivos.set(antigoUserId, (atendimentosAtivos.get(antigoUserId) || []).filter(t => t !== tel));

      const membro = await interaction.guild.members.fetch(novoUserId);
      estadoTelefones[tel] = { userId: novoUserId, nome: membro.user.username };

      if (!atendimentosAtivos.has(novoUserId)) atendimentosAtivos.set(novoUserId, []);
      atendimentosAtivos.get(novoUserId).push(tel);

      telefoneSelecionado.delete(interaction.user.id);

      await atualizarPainel();
      await enviarRelatorio('🔁 Transferência', `Telefone **${tel}** transferido de **${antigoUserNome}** para **${membro.user.username}**`);
      return interaction.update({ content: `🔁 Telefone **${tel}** transferido.`, components: [] });
    }

    /* ===== TICKET ===== */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) return replyEphemeral('❌ Apenas telefonistas.');
      if (ticketsAbertos.has(interaction.user.id)) return replyEphemeral('⚠️ Você já tem ticket aberto.');

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
      await canal.send('🎫 Ticket iniciado.');
      return replyEphemeral(`✅ Ticket criado: ${canal}`);
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
