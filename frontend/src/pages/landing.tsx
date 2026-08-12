import { type PointerEvent as ReactPointerEvent, useEffect, useState } from "react";

import { arr, txt, useUtmCaptureAndBuildLink } from "@/components/landing-blocks/utils";
import type { LandingApiResponse } from "@/components/landing-blocks/types";
import { api, type PublicConfig } from "@/lib/api";
import { fetchLanding } from "@/lib/landing-api";
import brandMark from "@/assets/lazeyka-landing/brand-mark-small.png";
import ctaPortal from "@/assets/lazeyka-landing/cta-portal.jpg";
import devicesWorld from "@/assets/lazeyka-landing/devices-world.jpg";
import heroWorld from "@/assets/lazeyka-landing/hero-world.jpg";
import routeWorld from "@/assets/lazeyka-landing/route-world.jpg";

import {
  FALLBACK_TARIFFS,
  mapPublicTariffs,
  resolveFaq,
  telegramUrl,
  type LandingTariff,
} from "./lazeyka-landing-model";
import "./lazeyka-landing.css";

interface LandingPageProps {
  config: PublicConfig;
}

type IconName = "arrow" | "send" | "check" | "chevron" | "spark";

const NAV = [["Преимущества", "#benefits"], ["Как подключиться", "#route"], ["Тарифы", "#tariffs"], ["FAQ", "#faq"]] as const;
const FALLBACK_BENEFITS = [
  { title: "Стабильный маршрут", desc: "Лазейка сама находит рабочий путь к нужным сервисам — менять серверы вручную не придётся." },
  { title: "Понятная цена", desc: "Платишь за подходящий сценарий, а не за длинный список функций, которыми не пользуешься." },
  { title: "Доступ остаётся", desc: "Telegram и сайт Лазейки доступны ещё 7 дней после окончания подписки — без тупиковых ситуаций." },
];
const STEPS = [
  ["01", "Создай аккаунт", "Почта и пароль — без длинной анкеты."],
  ["02", "Выбери тариф", "Понятные варианты под твой сценарий."],
  ["03", "Добавь подписку", "Кабинет подскажет приложение и даст готовую ссылку."],
] as const;
const PLATFORMS = [["Все", "all"], ["Телефон", "mobile"], ["Компьютер", "desktop"]] as const;
const DEVICES = [["iOS", "mobile"], ["Android", "mobile"], ["Windows", "desktop"], ["macOS", "desktop"], ["Linux", "desktop"]] as const;

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    send: <><path d="m21 3-7 18-4-7-7-4 18-7Z"/><path d="m10 14 11-11"/></>,
    check: <path d="m5 12 4 4 10-10"/>,
    chevron: <path d="m7 10 5 5 5-5"/>,
    spark: <><path d="m12 3 1 4 4 2-4 2-1 4-1-4-4-2 4-2 1-4Z"/><path d="m19 15 .5 2 2 .5-2 .5-.5 2-.5-2-2-.5 2-.5.5-2Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Logo({ logo, serviceName }: { logo?: string | null; serviceName: string }) {
  const words = serviceName.trim().split(/\s+/);
  const suffix = words.length > 1 ? words.pop() : "ВПН";
  return <a className="brand" href="#top"><img src={logo || brandMark} alt=""/><span>{words.join(" ") || "Лазейка"} <b>{suffix}</b></span></a>;
}

function trackBenefitGlow(event: ReactPointerEvent<HTMLElement>) {
  const card = (event.target as HTMLElement).closest<HTMLElement>(".benefit");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--glow-x", `${event.clientX - rect.left}px`);
  card.style.setProperty("--glow-y", `${event.clientY - rect.top}px`);
}

function TariffCard({ plan, selected, registerUrl, onSelect }: { plan: LandingTariff; selected: boolean; registerUrl: string; onSelect: () => void }) {
  return <article className={`plan ${selected ? "is-selected" : ""}`} onClick={onSelect}>
    {plan.popular ? <span className="popular">Выбор большинства</span> : null}
    <button className="plan__pick" aria-pressed={selected} onClick={onSelect}>
      <span className="plan__name">{plan.name}</span>
      <small>{plan.description}</small>
      <div className="price"><strong>{plan.price}</strong><span>₽ / месяц</span></div>
      <dl>
        <div><dt>Обход ограничений</dt><dd>Безлимит</dd></div>
        <div><dt>Белые списки</dt><dd>{plan.trafficGb ? `${plan.trafficGb} ГБ` : "Безлимит"}</dd></div>
        <div><dt>Устройства</dt><dd>до {plan.devices}</dd></div>
      </dl>
    </button>
    <a className={`button ${plan.popular ? "button--primary" : "button--ghost"}`} href={registerUrl}>Выбрать <Icon name="arrow"/></a>
  </article>;
}

export function LandingPage({ config }: LandingPageProps) {
  const buildLink = useUtmCaptureAndBuildLink();
  const [landing, setLanding] = useState<LandingApiResponse | null>(null);
  const [tariffs, setTariffs] = useState<LandingTariff[]>(FALLBACK_TARIFFS);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [selectedPlan, setSelectedPlan] = useState(FALLBACK_TARIFFS.find((plan) => plan.popular)?.id ?? FALLBACK_TARIFFS[0].id);
  const [platform, setPlatform] = useState("all");
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    let active = true;
    fetchLanding(config.defaultLanguage ?? "ru").then((value) => active && setLanding(value)).catch(() => undefined);
    api.getPublicTariffs().then(({ items }) => {
      if (!active) return;
      const mapped = mapPublicTariffs(items);
      setTariffs(mapped);
      setSelectedPlan(mapped.find((plan) => plan.popular)?.id ?? mapped[0].id);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [config.defaultLanguage]);

  useEffect(() => {
    let frame = 0;
    const root = document.querySelector<HTMLElement>(".lazeyka-landing");
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 16);
      root?.style.setProperty("--scroll", `${Math.min(window.scrollY, 900)}px`);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    return () => { removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll(".lazeyka-landing .reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("is-visible");
    }), { threshold: 0.12 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const blocks = new Map((landing?.blocks ?? []).map((block) => [block.type, block.text]));
  const hero = blocks.get("hero") ?? {};
  const benefitsCopy = blocks.get("benefits") ?? {};
  const tariffCopy = blocks.get("tariffs") ?? {};
  const devicesCopy = blocks.get("devices") ?? {};
  const faqCopy = blocks.get("faq") ?? {};
  const cta = blocks.get("cta") ?? {};
  const footerCopy = blocks.get("custom") ?? {};
  const benefits = arr<{ title?: string; desc?: string }>(benefitsCopy, "items", FALLBACK_BENEFITS).slice(0, 3);
  const faqs = resolveFaq(landing);
  const filteredDevices = platform === "all" ? DEVICES : DEVICES.filter(([, type]) => type === platform);
  const botUrl = telegramUrl(config.telegramBotUsername, "lazeika_vpn_bot");
  const supportUrl = config.supportLink?.trim() || "https://t.me/lazeika_support_bot";
  const loginUrl = buildLink("/cabinet/login");
  const registerUrl = buildLink("/cabinet/register");
  const primaryTariffs = tariffs.slice(0, 3);
  const extraTariffs = tariffs.slice(3);

  return <div className="lazeyka-landing">
    <div className="app" id="top">
      <div className="grid" aria-hidden="true"/><div className="aurora" aria-hidden="true"/>
      <header className={`header ${scrolled ? "is-scrolled" : ""}`}>
        <div className="header__inner shell">
          <Logo logo={config.logo} serviceName={config.serviceName}/>
          <nav className="nav" aria-label="Основная навигация">{NAV.map(([label, href]) => <a key={href} href={href}>{label}</a>)}</nav>
          <div className="header__actions">
            <a className="login" href={loginUrl}>Войти</a>
            <a className="button button--primary button--small" href={registerUrl}>{txt(hero, "ctaText", "Создать аккаунт")}</a>
            <button className={`menu ${menuOpen ? "is-open" : ""}`} onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen}><span/><span/><span/></button>
          </div>
        </div>
        <nav className={`mobile-nav shell ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}><div>{NAV.map(([label, href]) => <a key={href} href={href} tabIndex={menuOpen ? undefined : -1} onClick={() => setMenuOpen(false)}>{label}</a>)}<a href={loginUrl} tabIndex={menuOpen ? undefined : -1}>Войти в кабинет</a><a className="button button--primary" href={registerUrl} tabIndex={menuOpen ? undefined : -1}>{txt(hero, "ctaText", "Создать аккаунт")}</a></div></nav>
      </header>

      <main>
        <section className="hero shell">
          <div className="hero__copy">
            <h1>{txt(hero, "headline1", "VPN, который")}<br/><span>{txt(hero, "headline2", "находит лазейку.")}</span></h1>
            <p>{txt(hero, "subtitle", "Стабильный защищённый доступ к нужным сайтам и сервисам без ручной настройки. Подключайся один раз — дальше Лазейка разберётся сама.")}</p>
            <div className="actions"><a className="button button--primary" href={registerUrl}>{txt(hero, "ctaText", "Подключиться")} <Icon name="arrow"/></a><a className="button button--ghost" href={botUrl} target="_blank" rel="noreferrer"><Icon name="send"/> Открыть Telegram-бот</a></div>
            <div className="trust"><span><Icon name="check" size={16}/> До 5 устройств</span><span><Icon name="check" size={16}/> Запуск за минуту</span><span><Icon name="check" size={16}/> Поддержка рядом</span></div>
          </div>
          <div className="hero__visual"><img src={heroWorld} alt="Пиксельный персонаж Лазейки рядом с защищённым сетевым тоннелем"/><div className="status"><i/><div><span>Соединение</span><strong>Защищено</strong></div><b>42 ms</b></div></div>
        </section>

        <section className="section shell reveal" id="benefits">
          <div className="heading"><div><span className="kicker">Почему Лазейка</span><h2>{txt(benefitsCopy, "title", "Сложное остаётся на нашей стороне.")}</h2></div><p>{txt(benefitsCopy, "subtitle", "Лазейка не требует разбираться в протоколах и серверах. Ты просто пользуешься интернетом.")}</p></div>
          <div className="benefit-surface" onPointerMove={trackBenefitGlow}>{benefits.map((benefit, index) => <article className="benefit" key={`${benefit.title}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div className="benefit__icon"><Icon name="spark"/></div><h3>{benefit.title || FALLBACK_BENEFITS[index]?.title}</h3><p>{benefit.desc || FALLBACK_BENEFITS[index]?.desc}</p></article>)}</div>
        </section>

        <section className="section route shell reveal" id="route">
          <div className="route__copy"><span className="kicker">Маршрут найден</span><h2>Три шага —<br/><em>и ты в сети.</em></h2><p>Никаких конфигов и списков серверов. Кабинет ведёт до готового подключения.</p><div className="steps">{STEPS.map(([number, title, text], index) => <button key={number} className={activeStep === index ? "is-active" : ""} onClick={() => setActiveStep(index)} aria-pressed={activeStep === index}><span>{number}</span><div><strong>{title}</strong><small>{text}</small></div></button>)}</div></div>
          <div className="route__visual"><img src={routeWorld} alt="Пиксельная карта устойчивого маршрута от пользователя к сервису"/><div className="route__caption"><span><i/> Канал активен</span><strong>{STEPS[activeStep][1]}</strong><b>{42 + activeStep * 7} ms</b></div></div>
        </section>

        <section className="section shell reveal" id="tariffs">
          <div className="heading"><div><span className="kicker">Тарифы</span><h2>{txt(tariffCopy, "title", "Выбери свой запас свободы.")}</h2></div><p>{txt(tariffCopy, "subtitle", "Во всех основных тарифах обход ограничений безлимитный. Отличается объём маршрута белых списков.")}</p></div>
          <div className="plans">{primaryTariffs.map((plan) => <TariffCard key={plan.id} plan={plan} selected={selectedPlan === plan.id} registerUrl={registerUrl} onSelect={() => setSelectedPlan(plan.id)}/>)}</div>
          {extraTariffs.map((plan) => <div className="plain-plan" key={plan.id}><div><span>{plan.description}</span><h3>{plan.name}</h3><p>{plan.trafficGb ? `${plan.trafficGb} ГБ трафика` : "Безлимитный трафик"} · до {plan.devices} устройств</p></div><strong>{plan.price} <small>₽ / месяц</small></strong><a className="button button--ghost" href={registerUrl}>Выбрать <Icon name="arrow"/></a></div>)}
        </section>

        <section className="section devices shell reveal" id="devices">
          <div className="devices__visual"><img src={devicesWorld} alt="Телефон, ноутбук и роутер подключены к Лазейке"/></div>
          <div className="devices__copy"><span className="kicker">Устройства</span><h2>{txt(devicesCopy, "title", "Один доступ. Все твои экраны.")}</h2><p>{txt(devicesCopy, "subtitle", "Подключай телефон, компьютер и домашние устройства. Инструкции уже внутри кабинета.")}</p><div className="tabs" role="tablist">{PLATFORMS.map(([label, value]) => <button key={value} role="tab" aria-selected={platform === value} onClick={() => setPlatform(value)}>{label}</button>)}</div><div className="platforms">{filteredDevices.map(([label]) => <span key={label}><i/> {label}</span>)}</div><a className="text-link" href={registerUrl}>Посмотреть инструкции <Icon name="arrow"/></a></div>
        </section>

        <section className="section faq shell reveal" id="faq">
          <div className="faq__heading"><span className="kicker">Частые вопросы</span><h2>{txt(faqCopy, "title", "Коротко о главном.")}</h2><p>Не нашли ответ? <a href={supportUrl} target="_blank" rel="noreferrer">Напишите в поддержку</a>.</p></div>
          <div className="faq__list">{faqs.map(([question, answer], index) => <article className={openFaq === index ? "is-open" : ""} key={question}><button onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}><span>{question}</span><Icon name="chevron"/></button><div><p>{answer}</p></div></article>)}</div>
        </section>

        <section className="final shell reveal"><div><span className="kicker">{txt(cta, "eyebrow", "Можно начинать")}</span><h2>{txt(cta, "title", "Твоя лазейка уже открыта.")}</h2><p>{txt(cta, "desc", "Создай аккаунт и подключись за минуту. Или зайди через Telegram — там регистрация не нужна.")}</p><div className="actions"><a className="button button--primary" href={registerUrl}>{txt(cta, "ctaText", "Создать аккаунт")} <Icon name="arrow"/></a><a className="button button--ghost" href={botUrl} target="_blank" rel="noreferrer"><Icon name="send"/> Открыть бота</a></div></div><img src={ctaPortal} alt="Светящийся портал Лазейки"/></section>
      </main>

      <footer className="footer shell"><Logo logo={config.logo} serviceName={config.serviceName}/><p>{txt(footerCopy, "footerText", config.landingConfig?.footerText || "© 2026 Лазейка ВПН")}</p><div><a href={config.landingConfig?.offerLink || "/offer"}>Оферта</a><a href={config.landingConfig?.privacyLink || "/privacy"}>Конфиденциальность</a><a href={supportUrl}>Поддержка</a></div></footer>
    </div>
  </div>;
}
