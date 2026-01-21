const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');

const http = require('http');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// Telefone atualizados
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

// Estado
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

// Util
function hoje() {
  return new Date().toLocaleDateString('pt-BR');
}
function hora() {
  return new Date().toLocaleTimeString('pt-BR');
}
function tempo(entrada) {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

// Relatório
async function atualizarRelatorio() {
  try {
    const canal = await client.channels.fetch(CANAL_RELATORIO_PRESENCA_ID);
    const data = hoje();
    if (!relatorioDiario[data]) return;

    let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;

    for (const tel of Object.keys(relatorioDiario[data])) {
      texto += `📞 **Telefone ${tel}**\n`;
      texto += relatorioDiario[data][tel].join('\n');
      texto += `\n----------------------\n`;
    }

    if (mensagemRelatorioId) {
      const msg = await canal.messages.fetch(mensagemRelatorioId).catch(() => null);
      if (msg) await msg.edit(texto);
      else {
        const novo = await canal.send(texto);
        mensagemRelatorioId = novo.id;
      }
    } else {
      const msg = await canal.send(texto);
      mensagemRelatorioId = msg.id;
    }
  } catch (err) {
    console.error('ERRO RELATORIO:', err);
  }
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
}

// Painel
async function atualizarPainel() {
  try {
    const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

    const status = telefones.map(t =>
      estadoTelefones[t]
        ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
        : `🟢 Telefone ${t} — Livre`
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
          .setCustomId('menu_sair')
          .setLabel('🟠 Desconectar UM')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('menu_transferir')
          .setLabel('🔵 Transferir')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('menu_forcar')
          .setLabel('⚠️ Forçar Desconexão')
          .setStyle(ButtonStyle.Secondary)
      )
    );

    const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

    if (mensagemPainelId) {
      const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
      if (msg) await msg.edit({ content: texto, components: rows });
      else {
        const novo = await canal.send({ content: texto, components: rows });
        mensagemPainelId = novo.id;
      }
    } else {
      const msg = await canal.send({ content: texto, components: rows });
      mensagemPainelId = msg.id;
    }
  } catch (err) {
    console.error('ERRO PAINEL:', err);
  }
}

// Bot
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
});

// Interações
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  try {
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[telefone]) return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: new Date() };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();

      await interaction.reply({ content: `📞 Conectado ao telefone **${telefone}**`, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    // Desconectar todos
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(user.id) || [];
      for (const tel of lista) {
        const dados = estadoTelefones[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.delete(user.id);
      await atualizarPainel();

      await interaction.reply({ content: '📴 Desconectado de todos os telefones', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    // Desconectar um
    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (lista.length === 0) return interaction.reply({ content: '⚠️ Você não está conectado em nenhum telefone.', ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const telefone = interaction.values[0];
      const dados = estadoTelefones[telefone];

      await registrarEvento(telefone, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
      delete estadoTelefones[telefone];
      atendimentosAtivos.set(user.id, atendimentosAtivos.get(user.id).filter(t => t !== telefone));

      await atualizarPainel();
      await interaction.update({ content: `✅ Telefone **${telefone}** desconectado.`, components: [] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    // Transferir
    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (lista.length === 0) return interaction.reply({ content: '⚠️ Você não está conectado em nenhum telefone.', ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      const telefone = interaction.values[0];
      const menuUser = new UserSelectMenuBuilder()
        .setCustomId(`transferir_user_${telefone}`)
        .setPlaceholder('Escolha o novo telefonista');

      return interaction.update({ components: [new ActionRowBuilder().addComponents(menuUser)] });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
      const telefone = interaction.customId.replace('transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = estadoTelefones[telefone];

      await registrarEvento(telefone, `🔁 ${hora()} — ${antigo.nome} transferiu para ${novoUser.username} (${tempo(antigo.entrada)})`);

      estadoTelefones[telefone] = { userId: novoId, nome: novoUser.username, entrada: new Date() };
      atendimentosAtivos.set(antigo.userId, atendimentosAtivos.get(antigo.userId).filter(t => t !== telefone));
      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(telefone);

      await atualizarPainel();
      await interaction.update({ content: `✅ Telefone **${telefone}** transferido para **${novoUser.username}**.`, components: [] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

    // Forçar desconexão
    if (interaction.isButton() && interaction.customId === 'menu_forcar') {
      const lista = Object.keys(estadoTelefones);
      if (lista.length === 0) return interaction.reply({ content: '⚠️ Nenhum telefone ativo.', ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('forcar_tel')
        .setPlaceholder('Escolha o telefone para forçar')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {
      const telefone = interaction.values[0];
      const dados = estadoTelefones[telefone];

      await registrarEvento(telefone, `⚠️ ${hora()} — ${dados.nome} foi desconectado FORÇADO (${tempo(dados.entrada)})`);
      delete estadoTelefones[telefone];
      if (atendimentosAtivos.has(dados.userId)) {
        atendimentosAtivos.set(dados.userId, atendimentosAtivos.get(dados.userId).filter(t => t !== telefone));
      }

      await atualizarPainel();
      await interaction.update({ content: `⚠️ Telefone **${telefone}** desconectado FORÇADO.`, components: [] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

client.login(TOKEN);

// HTTP listener simples para Render
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
