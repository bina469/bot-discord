require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const express = require('express');

/* ================= BLINDAGEM ================= */
if (!process.env.TOKEN) {
  console.error('❌ TOKEN não definido no ambiente');
  process.exit(1);
}

if (!process.env.CHANNEL_ID) {
  console.error('❌ CHANNEL_ID não definido no ambiente');
  process.exit(1);
}

const TOKEN = process.env.TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

/* ================= BOT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= TELEFONES ================= */
const telefones = [
  'Pathy', 'Samantha', 'Rosalia', 'Rafaela',
  'Sophia', 'Ingrid', 'Valentina', 'Melissa'
];

/* ================= ESTADO ================= */
const estadoTelefones = {};
const atendimentosAtivos = new Map();
let painelMessageId = null;

/* ================= PAINEL ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CHANNEL_ID);

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
      new ButtonBuilder()
        .setCustomId('sair_todos')
        .setLabel('🔴 Desconectar TODOS')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('sair_um')
        .setLabel('🟠 Desconectar UM')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('transferir')
        .setLabel('🔵 Transferir')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('forcar')
        .setLabel('🛑 Forçar Desconexão')
        .setStyle(ButtonStyle.Danger)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

  if (painelMessageId) {
    const msg = await canal.messages.fetch(painelMessageId);
    await msg.edit({ content: texto, components: rows });
  } else {
    const msg = await canal.send({ content: texto, components: rows });
    painelMessageId = msg.id;
  }
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  await atualizarPainel();
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  try {
    /* ===== ENTRAR ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[telefone]) {
        await interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });
        return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
      }

      estadoTelefones[telefone] = {
        userId: user.id,
        nome: user.username
      };

      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await atualizarPainel();

      await interaction.reply({ content: `📞 Conectado ao telefone ${telefone}`, ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    /* ===== SAIR TODOS ===== */
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];

      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(user.id);

      await atualizarPainel();

      await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
      return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    /* ===== SAIR UM ===== */
    if (interaction.isButton() && interaction.customId === 'sair_um') {
      const lista = atendimentosAtivos.get(user.id) || [];

      if (!lista.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });
        return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um_menu')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um_menu') {
      const tel = interaction.values[0];

      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        user.id,
        (atendimentosAtivos.get(user.id) || []).filter(t => t !== tel)
      );

      await atualizarPainel();
      await interaction.update({ components: [] });
      return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    /* ===== FORÇAR ===== */
    if (interaction.isButton() && interaction.customId === 'forcar') {
      const ocupados = Object.keys(estadoTelefones);

      if (!ocupados.length) {
        await interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });
        return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_menu')
        .setPlaceholder('Forçar desconexão')
        .addOptions(ocupados.map(t => ({ label: t, value: t })));

      return interaction.reply({
        ephemeral: true,
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_menu') {
      delete estadoTelefones[interaction.values[0]];
      await atualizarPainel();
      await interaction.update({ components: [] });
      return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    /* ===== TRANSFERIR (placeholder estável) ===== */
    if (interaction.isButton() && interaction.customId === 'transferir') {
      await interaction.reply({
        content: '🔄 Transferência está estável (etapa seguinte)',
        ephemeral: true
      });
      return setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

  } catch (e) {
    console.error('💥 Erro na interação:', e);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= EXPRESS (RENDER) ================= */
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot online ✅'));
app.listen(PORT, () => console.log(`🌐 Web ativo na porta ${PORT}`));
