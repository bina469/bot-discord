const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;
const CANAL_PAINEL_ID = 'SEU_CANAL_ID_AQUI';

const telefones = [
  'Pathy', 'Samantha', 'Rosalia', 'Rafaela', 'Sophia',
  'Ingrid', 'Valentina', 'Melissa', 'Alina'
];

let estadoTelefones = {};
let atendimentosAtivos = new Map();
let painelMsg = null;

/* ================= PAINEL ================= */

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_ID);

  let texto = '📞 **PAINEL DE PRESENÇA**\n\n';

  for (const tel of telefones) {
    if (estadoTelefones[tel]) {
      texto += `🔴 Telefone ${tel} — ${estadoTelefones[tel].nome}\n`;
    } else {
      texto += `🟢 Telefone ${tel} — Livre\n`;
    }
  }

  const botoes = [
    new ButtonBuilder().setCustomId('desconectar_todos').setLabel('Desconectar TODOS').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('desconectar_um').setLabel('Desconectar UM').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('transferir').setLabel('Transferir').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('forcar').setLabel('Forçar Desconexão').setStyle(ButtonStyle.Danger)
  ];

  const row = new ActionRowBuilder().addComponents(botoes);

  if (!painelMsg) {
    painelMsg = await canal.send({ content: texto, components: [row] });
  } else {
    await painelMsg.edit({ content: texto, components: [row] });
  }
}

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  /* ===== DESCONECTAR TODOS ===== */
  if (interaction.isButton() && interaction.customId === 'desconectar_todos') {
    for (const tel in estadoTelefones) delete estadoTelefones[tel];
    atendimentosAtivos.clear();
    await atualizarPainel();

    await interaction.reply({ content: '✅ Todos os telefones foram desconectados.', ephemeral: true });
    return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== DESCONECTAR UM ===== */
  if (interaction.isButton() && interaction.customId === 'desconectar_um') {
    const meus = atendimentosAtivos.get(user.id) || [];
    if (!meus.length) {
      await interaction.reply({ content: '⚠️ Você não está em nenhum telefone.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('desconectar_um_menu')
      .setPlaceholder('Escolha o telefone')
      .addOptions(meus.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '🔴 Qual telefone deseja desconectar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'desconectar_um_menu') {
    const tel = interaction.values[0];
    delete estadoTelefones[tel];

    const lista = atendimentosAtivos.get(user.id) || [];
    atendimentosAtivos.set(user.id, lista.filter(t => t !== tel));

    await atualizarPainel();
    await interaction.reply({ content: `✅ Telefone ${tel} desconectado.`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== FORÇAR ===== */
  if (interaction.isButton() && interaction.customId === 'forcar') {
    const ocupados = Object.keys(estadoTelefones);
    if (!ocupados.length) {
      await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('forcar_menu')
      .setPlaceholder('Escolha o telefone')
      .addOptions(ocupados.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '⛔ Qual telefone deseja forçar?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_menu') {
    const tel = interaction.values[0];
    const dono = estadoTelefones[tel]?.userId;
    delete estadoTelefones[tel];

    if (dono) {
      atendimentosAtivos.set(dono,
        (atendimentosAtivos.get(dono) || []).filter(t => t !== tel)
      );
    }

    await atualizarPainel();
    await interaction.reply({ content: `⛔ Telefone ${tel} forçado com sucesso.`, ephemeral: true });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }

  /* ===== TRANSFERIR ===== */
  if (interaction.isButton() && interaction.customId === 'transferir') {
    const meus = atendimentosAtivos.get(user.id) || [];
    if (!meus.length) {
      await interaction.reply({ content: '⚠️ Você não está em nenhum telefone.', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('transferir_tel')
      .setPlaceholder('Escolha o telefone')
      .addOptions(meus.map(t => ({ label: t, value: t })));

    await interaction.reply({
      content: '🔵 Qual telefone deseja transferir?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
    const tel = interaction.values[0];
    const membros = await interaction.guild.members.fetch();

    const elegiveis = membros.filter(m =>
      m.roles.cache.some(r => r.name === '.') && !m.user.bot
    );

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`transferir_user_${tel}`)
      .setPlaceholder('Escolha o telefonista')
      .addOptions(elegiveis.map(m => ({
        label: m.user.username,
        value: m.id
      })).slice(0, 25));

    await interaction.reply({
      content: '👤 Para quem deseja transferir?',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
    const tel = interaction.customId.replace('transferir_user_', '');
    const novoId = interaction.values[0];
    const membro = await interaction.guild.members.fetch(novoId);

    const antigo = estadoTelefones[tel];
    if (antigo) {
      atendimentosAtivos.set(
        antigo.userId,
        (atendimentosAtivos.get(antigo.userId) || []).filter(t => t !== tel)
      );
    }

    estadoTelefones[tel] = { userId: novoId, nome: membro.user.username };
    if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
    atendimentosAtivos.get(novoId).push(tel);

    await atualizarPainel();
    await interaction.reply({
      content: `🔄 Telefone ${tel} transferido para ${membro.user.username}`,
      ephemeral: true
    });
    setTimeout(() => interaction.deleteReply().catch(()=>{}), 3000);
  }
});

/* ================= START ================= */

client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

client.login(TOKEN);
