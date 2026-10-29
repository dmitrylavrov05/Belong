"""Все тексты бота. {promo} подставляется автоматически."""

T = {
    "ru": {
        # --- onboarding
        "choose": "🌍 Выбери язык / Escolha o idioma:",
        "age_q": "🔞 Бонусы и игры доступны только совершеннолетним.\n\n<b>Тебе уже есть 18 лет?</b>",
        "age_yes": "✅ Да, мне 18+",
        "age_no": "❌ Нет",
        "age_denied": "Извини, бот доступен только с 18 лет. Возвращайся, когда исполнится 🙌",
        "welcome": (
            "🚀 <b>Добро пожаловать в ROCKET BIG!</b>\n\n"
            "Здесь ты заберёшь бонус <b>до +500%</b> на первый депозит в <b>1win</b> по нашему промокоду.\n\n"
            "🔑 Промокод: <code>{promo}</code>  ← нажми, чтобы скопировать\n\n"
            "Всего 3 шага, займёт ~2 минуты:\n"
            "1️⃣ Регистрация по кнопке ниже\n"
            "2️⃣ Ввод промокода <b>{promo}</b>\n"
            "3️⃣ Первое пополнение — бонус начислится автоматически\n\n"
            "<i>Условия бонуса и отыгрыша смотри на сайте 1win. Играй ответственно.</i>"
        ),
        "btn_start_steps": "🚀 Начать — шаг 1",
        # --- step 1
        "step1": (
            "<b>Шаг 1 из 3 — регистрация</b>\n\n"
            "Нажми кнопку ниже и зарегистрируйся на 1win (почта или телефон — 1 минута).\n\n"
            "⚠️ Важно: регистрируйся <b>именно по этой кнопке</b>, иначе бонус от нас не привяжется.\n\n"
            "Когда закончишь — возвращайся и жми «Я зарегистрировался»."
        ),
        "btn_reg": "📝 Зарегистрироваться на 1win",
        "btn_reg_done": "✅ Я зарегистрировался",
        # --- step 2
        "step2": (
            "🔥 <b>Отлично! Шаг 2 из 3 — промокод</b>\n\n"
            "Введи промокод в поле «Промокод» при регистрации или в разделе <b>Профиль → Бонусы</b>:\n\n"
            "👉 <code>{promo}</code>\n\n"
            "Без промокода повышенный бонус не активируется."
        ),
        "btn_promo_done": "✅ Промокод введён",
        # --- step 3
        "step3": (
            "💎 <b>Последний шаг — первое пополнение</b>\n\n"
            "Бонус до +500% начисляется на <b>первый депозит</b> — поэтому именно первое пополнение самое выгодное.\n\n"
            "Как пополнить:\n"
            "• На сайте нажми «Пополнить»\n"
            "• Выбери удобный способ оплаты\n"
            "• Бонус зачислится автоматически\n\n"
            "💡 Пополняй только ту сумму, которую готов потратить на игру."
        ),
        "btn_deposit": "💳 Пополнить на 1win",
        "btn_dep_done": "✅ Я пополнил",
        "deposited": (
            "🎉 <b>Поздравляем, бонус твой!</b>\n\n"
            "Пара советов, чтобы получить от него максимум:\n"
            "• Бонус нужно отыграть — условия в разделе «Бонусы» на сайте\n"
            "• Поставь себе лимит депозитов в настройках профиля\n"
            "• Не пытайся отыграться — делай перерывы\n\n"
            "Я буду иногда присылать новости и акции. Удачи! 🚀"
        ),
        "btn_more": "🌍 Сменить язык",
        "btn_stop": "🔕 Не присылать напоминания",
        "stopped": "🔕 Ок, больше не буду присылать напоминания. Вернуть: /start",
        # --- drip: не начал регистрацию
        "d_new_1": (
            "👋 Ты остановился в шаге от бонуса <b>до +500%</b>.\n\n"
            "Регистрация занимает минуту, а промокод <code>{promo}</code> уже ждёт тебя."
        ),
        "d_new_2": (
            "🎁 <b>Как работает бонус +500%?</b>\n\n"
            "Когда ты делаешь первое пополнение с промокодом <code>{promo}</code>, 1win начисляет бонусные средства сверху — "
            "в разы больше, чем стандартное приветствие без кода.\n\n"
            "Всё, что нужно, — зарегистрироваться по нашей кнопке."
        ),
        "d_new_3": (
            "⏳ Последнее напоминание от меня: промокод <code>{promo}</code> и бонус до +500% всё ещё доступны.\n\n"
            "Больше не побеспокою — если решишь, просто нажми кнопку ниже 🙂"
        ),
        # --- drip: зарегистрировался, не пополнил
        "d_reg_1": (
            "✅ Регистрация есть — осталось активировать бонус!\n\n"
            "Проверь, что промокод <code>{promo}</code> введён (Профиль → Бонусы), и сделай первое пополнение — "
            "бонус до +500% начисляется только на него."
        ),
        "d_reg_2": (
            "💡 <b>Частые вопросы</b>\n\n"
            "<b>Где ввести промокод?</b> Профиль → Бонусы → поле «Промокод».\n"
            "<b>Когда придёт бонус?</b> Сразу после первого пополнения.\n"
            "<b>Как его вывести?</b> После отыгрыша по условиям на сайте.\n\n"
            "Остались вопросы — просто напиши сюда."
        ),
        "d_reg_3": (
            "🚀 Твой бонус на первый депозит всё ещё не активирован.\n\n"
            "Это самый выгодный момент: повышенный процент действует только на первое пополнение по коду <code>{promo}</code>."
        ),
        "d_reg_4": (
            "Напоминаю в последний раз: бонус до +500% по коду <code>{promo}</code> ждёт активации. "
            "Больше не буду об этом писать 🙂"
        ),
        # --- drip: пополнил
        "d_dep_1": (
            "📘 <b>Как отыграть бонус</b>\n\n"
            "• Открой раздел «Бонусы» — там видно, сколько осталось отыграть\n"
            "• Читай условия: не все игры засчитываются одинаково\n"
            "• Ставь лимиты и делай перерывы — играть нужно для удовольствия\n\n"
            "Если чувствуешь, что игра перестала быть развлечением, — в профиле 1win можно включить самоисключение."
        ),
        # --- support
        "support": "✍️ Спасибо за сообщение! Нажми /start, чтобы вернуться к шагам.",
    },
    "pt": {
        "choose": "🌍 Escolha o idioma / Выбери язык:",
        "age_q": "🔞 Bônus e jogos são apenas para maiores de idade.\n\n<b>Você tem 18 anos ou mais?</b>",
        "age_yes": "✅ Sim, tenho 18+",
        "age_no": "❌ Não",
        "age_denied": "Desculpe, o bot é apenas para maiores de 18 anos. Volte quando fizer 18 🙌",
        "welcome": (
            "🚀 <b>Bem-vindo ao ROCKET BIG!</b>\n\n"
            "Aqui você pega um bônus de <b>até +500%</b> no primeiro depósito na <b>1win</b> com o nosso código.\n\n"
            "🔑 Código: <code>{promo}</code>  ← toque para copiar\n\n"
            "Só 3 passos, ~2 minutos:\n"
            "1️⃣ Cadastro pelo botão abaixo\n"
            "2️⃣ Inserir o código <b>{promo}</b>\n"
            "3️⃣ Primeiro depósito — o bônus cai automaticamente\n\n"
            "<i>Veja as regras do bônus e do rollover no site da 1win. Jogue com responsabilidade.</i>"
        ),
        "btn_start_steps": "🚀 Começar — passo 1",
        "step1": (
            "<b>Passo 1 de 3 — cadastro</b>\n\n"
            "Toque no botão abaixo e cadastre-se na 1win (e-mail ou telefone — 1 minuto).\n\n"
            "⚠️ Importante: cadastre-se <b>por este botão</b>, senão o nosso bônus não é vinculado.\n\n"
            "Quando terminar, volte e toque em «Já me cadastrei»."
        ),
        "btn_reg": "📝 Cadastrar na 1win",
        "btn_reg_done": "✅ Já me cadastrei",
        "step2": (
            "🔥 <b>Boa! Passo 2 de 3 — código</b>\n\n"
            "Insira o código no campo «Código promocional» no cadastro ou em <b>Perfil → Bônus</b>:\n\n"
            "👉 <code>{promo}</code>\n\n"
            "Sem o código, o bônus maior não é ativado."
        ),
        "btn_promo_done": "✅ Código inserido",
        "step3": (
            "💎 <b>Último passo — primeiro depósito</b>\n\n"
            "O bônus de até +500% vale para o <b>primeiro depósito</b> — por isso ele é o mais vantajoso.\n\n"
            "Como depositar:\n"
            "• No site, toque em «Depositar»\n"
            "• Escolha o método (PIX e outros)\n"
            "• O bônus é creditado automaticamente\n\n"
            "💡 Deposite apenas o valor que você pode gastar com diversão."
        ),
        "btn_deposit": "💳 Depositar na 1win",
        "btn_dep_done": "✅ Já depositei",
        "deposited": (
            "🎉 <b>Parabéns, o bônus é seu!</b>\n\n"
            "Dicas para aproveitar melhor:\n"
            "• O bônus precisa de rollover — regras na seção «Bônus» do site\n"
            "• Defina um limite de depósito nas configurações do perfil\n"
            "• Não tente recuperar perdas — faça pausas\n\n"
            "Vou mandar novidades e promoções de vez em quando. Boa sorte! 🚀"
        ),
        "btn_more": "🌍 Mudar idioma",
        "btn_stop": "🔕 Não enviar lembretes",
        "stopped": "🔕 Ok, não vou mais enviar lembretes. Para voltar: /start",
        "d_new_1": (
            "👋 Você parou a um passo do bônus de <b>até +500%</b>.\n\n"
            "O cadastro leva um minuto e o código <code>{promo}</code> já está te esperando."
        ),
        "d_new_2": (
            "🎁 <b>Como funciona o bônus de +500%?</b>\n\n"
            "No primeiro depósito com o código <code>{promo}</code>, a 1win credita um saldo de bônus extra — "
            "muito maior que a boas-vindas padrão sem código.\n\n"
            "Basta se cadastrar pelo nosso botão."
        ),
        "d_new_3": (
            "⏳ Último lembrete: o código <code>{promo}</code> e o bônus de até +500% ainda estão disponíveis.\n\n"
            "Não vou mais incomodar — se decidir, é só tocar no botão abaixo 🙂"
        ),
        "d_reg_1": (
            "✅ Cadastro feito — falta ativar o bônus!\n\n"
            "Confira se o código <code>{promo}</code> foi inserido (Perfil → Bônus) e faça o primeiro depósito — "
            "o bônus de até +500% vale só para ele."
        ),
        "d_reg_2": (
            "💡 <b>Perguntas frequentes</b>\n\n"
            "<b>Onde insiro o código?</b> Perfil → Bônus → campo «Código promocional».\n"
            "<b>Quando o bônus cai?</b> Logo após o primeiro depósito.\n"
            "<b>Como saco?</b> Depois de cumprir o rollover conforme as regras do site.\n\n"
            "Ficou com dúvida? É só escrever aqui."
        ),
        "d_reg_3": (
            "🚀 Seu bônus de primeiro depósito ainda não foi ativado.\n\n"
            "Esse é o momento mais vantajoso: a porcentagem maior vale só no primeiro depósito com o código <code>{promo}</code>."
        ),
        "d_reg_4": (
            "Último lembrete: o bônus de até +500% com o código <code>{promo}</code> está esperando ativação. "
            "Não vou mais falar disso 🙂"
        ),
        "d_dep_1": (
            "📘 <b>Como cumprir o rollover do bônus</b>\n\n"
            "• Abra a seção «Bônus» — lá aparece quanto falta\n"
            "• Leia as regras: nem todos os jogos contam igual\n"
            "• Defina limites e faça pausas — jogar é diversão\n\n"
            "Se o jogo deixar de ser diversão, no perfil da 1win dá para ativar a autoexclusão."
        ),
        "support": "✍️ Obrigado pela mensagem! Toque em /start para voltar aos passos.",
    },
}

# Цепочки автосообщений: стадия -> [(через сколько часов после входа в стадию, ключ текста, кнопка)]
# кнопка: "reg" — регистрация, "dep" — пополнение, None — без кнопки действия
DRIP = {
    "age_ok":     [(1, "d_new_1", "reg"), (24, "d_new_2", "reg"), (72, "d_new_3", "reg")],
    "clicked":    [(2, "d_new_1", "reg"), (26, "d_new_2", "reg"), (74, "d_new_3", "reg")],
    "registered": [(3, "d_reg_1", "dep"), (24, "d_reg_2", "dep"), (72, "d_reg_3", "dep"), (168, "d_reg_4", "dep")],
    "promo":      [(3, "d_reg_1", "dep"), (24, "d_reg_2", "dep"), (72, "d_reg_3", "dep"), (168, "d_reg_4", "dep")],
    "deposited":  [(24, "d_dep_1", None)],
}

T["en"] = {
    "choose": "🌍 Choose your language:",
    "age_q": "🔞 Bonuses and games are for adults only.\n\n<b>Are you 18 or older?</b>",
    "age_yes": "✅ Yes, I'm 18+",
    "age_no": "❌ No",
    "age_denied": "Sorry, this bot is for 18+ only. Come back when you turn 18 🙌",
    "welcome": (
        "🚀 <b>Welcome to ROCKET BIG!</b>\n\n"
        "Get a bonus of <b>up to +500%</b> on your first deposit at <b>1win</b> with our promo code.\n\n"
        "🔑 Promo code: <code>{promo}</code>  ← tap to copy\n\n"
        "Just 3 steps, ~2 minutes:\n"
        "1️⃣ Sign up with the button below\n"
        "2️⃣ Enter the code <b>{promo}</b>\n"
        "3️⃣ Make your first deposit — the bonus is credited automatically\n\n"
        "<i>Bonus and wagering terms are on the 1win website. Play responsibly.</i>"
    ),
    "btn_start_steps": "🚀 Start — step 1",
    "step1": (
        "<b>Step 1 of 3 — sign up</b>\n\n"
        "Tap the button below and sign up at 1win (email or phone — 1 minute).\n\n"
        "⚠️ Important: sign up <b>using this button</b>, otherwise our bonus won't be linked.\n\n"
        "When you're done, come back and tap «I've signed up»."
    ),
    "btn_reg": "📝 Sign up at 1win",
    "btn_reg_done": "✅ I've signed up",
    "step2": (
        "🔥 <b>Great! Step 2 of 3 — promo code</b>\n\n"
        "Enter the code in the «Promo code» field when signing up or in <b>Profile → Bonuses</b>:\n\n"
        "👉 <code>{promo}</code>\n\n"
        "Without the code, the bigger bonus won't be activated."
    ),
    "btn_promo_done": "✅ Code entered",
    "step3": (
        "💎 <b>Last step — first deposit</b>\n\n"
        "The up to +500% bonus applies to your <b>first deposit</b> — that's why it's the most rewarding one.\n\n"
        "How to deposit:\n"
        "• On the site, tap «Deposit»\n"
        "• Choose a payment method\n"
        "• The bonus is credited automatically\n\n"
        "💡 Only deposit an amount you're comfortable spending on entertainment."
    ),
    "btn_deposit": "💳 Deposit at 1win",
    "btn_dep_done": "✅ I've deposited",
    "deposited": (
        "🎉 <b>Congrats, the bonus is yours!</b>\n\n"
        "A few tips to get the most out of it:\n"
        "• The bonus has wagering requirements — see «Bonuses» on the site\n"
        "• Set a deposit limit in your profile settings\n"
        "• Don't chase losses — take breaks\n\n"
        "I'll send news and promotions from time to time. Good luck! 🚀"
    ),
    "btn_more": "🌍 Change language",
    "btn_stop": "🔕 Stop reminders",
    "stopped": "🔕 Ok, no more reminders. To come back: /start",
    "d_new_1": (
        "👋 You stopped one step away from a bonus of <b>up to +500%</b>.\n\n"
        "Signing up takes a minute and the code <code>{promo}</code> is waiting for you."
    ),
    "d_new_2": (
        "🎁 <b>How does the +500% bonus work?</b>\n\n"
        "When you make your first deposit with the code <code>{promo}</code>, 1win adds bonus funds on top — "
        "much more than the standard welcome offer without a code.\n\n"
        "All you need is to sign up with our button."
    ),
    "d_new_3": (
        "⏳ Last reminder from me: the code <code>{promo}</code> and the up to +500% bonus are still available.\n\n"
        "I won't bother you again — if you decide, just tap the button below 🙂"
    ),
    "d_reg_1": (
        "✅ You're signed up — now activate your bonus!\n\n"
        "Check that the code <code>{promo}</code> is entered (Profile → Bonuses) and make your first deposit — "
        "the up to +500% bonus only applies to it."
    ),
    "d_reg_2": (
        "💡 <b>FAQ</b>\n\n"
        "<b>Where do I enter the code?</b> Profile → Bonuses → «Promo code» field.\n"
        "<b>When do I get the bonus?</b> Right after your first deposit.\n"
        "<b>How do I withdraw it?</b> After meeting the wagering terms on the site.\n\n"
        "Any questions? Just write here."
    ),
    "d_reg_3": (
        "🚀 Your first-deposit bonus is still not activated.\n\n"
        "This is the best moment: the higher percentage only applies to your first deposit with the code <code>{promo}</code>."
    ),
    "d_reg_4": (
        "Last reminder: the up to +500% bonus with the code <code>{promo}</code> is waiting to be activated. "
        "I won't mention it again 🙂"
    ),
    "d_dep_1": (
        "📘 <b>How to wager your bonus</b>\n\n"
        "• Open «Bonuses» — it shows how much is left to wager\n"
        "• Read the terms: not all games count the same\n"
        "• Set limits and take breaks — play for fun\n\n"
        "If gaming stops being fun, you can enable self-exclusion in your 1win profile."
    ),
    "support": "✍️ Thanks for your message! Tap /start to get back to the steps.",
}
T["ru"]["choose"] = T["pt"]["choose"] = T["en"]["choose"] = "🌍 Выбери язык / Escolha o idioma / Choose language:"
