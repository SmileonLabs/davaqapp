import { useState } from "react";
import appIcon from "../../../mobile/assets/images/icon.png";
import appServicePreview from "../assets/fan-home.png";
import { type PwaPlatform, usePwa } from "@/hooks/use-pwa";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  LayoutGrid,
  MessageCircle,
  Mic2,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const appUrl = import.meta.env.DEV ? "http://127.0.0.1:3100/app/" : "/app/";

const installGuides: Record<PwaPlatform, { title: string; description: string; steps: string[] }> = {
  ios: {
    title: "iPhone/iPad에 설치하기",
    description: "Safari의 공유 메뉴에서 홈 화면에 추가하면 앱처럼 실행할 수 있어요.",
    steps: ["Safari에서 공유 아이콘을 누르세요.", "‘홈 화면에 추가’를 선택하세요.", "홈 화면의 DavaQ 아이콘으로 바로 시작하세요."],
  },
  android: {
    title: "Android에 설치하기",
    description: "Chrome 메뉴에서 설치하거나 홈 화면에 추가할 수 있어요.",
    steps: ["Chrome 오른쪽 상단 메뉴를 여세요.", "‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택하세요.", "설치 후 DavaQ 아이콘으로 바로 시작하세요."],
  },
  desktop: {
    title: "PC에 설치하기",
    description: "Chrome 또는 Edge에서 DavaQ를 데스크톱 앱처럼 사용할 수 있어요.",
    steps: ["주소창 오른쪽의 설치 아이콘 또는 브라우저 메뉴를 여세요.", "‘설치’ 또는 ‘페이지를 앱으로 설치’를 선택하세요.", "시작 메뉴나 바탕화면의 DavaQ를 실행하세요."],
  },
};

const experiences: { eyebrow: string; title: string; body: string; icon: LucideIcon; tone: string }[] = [
  {
    eyebrow: "IDENTITY",
    title: "나만의 캐릭터 프로필",
    body: "FAN으로 시작해 내 취향과 성장 기록을 쌓고, 필요할 때 여러 캐릭터 프로필을 전환해 활동할 수 있어요.",
    icon: Users,
    tone: "from-violet-500/25 to-fuchsia-500/5",
  },
  {
    eyebrow: "SOCIAL",
    title: "피드와 응원으로 연결",
    body: "STAR와 FAN의 이야기를 피드에서 만나고, 응원·댓글·팔로우로 함께 성장하는 관계를 만들어요.",
    icon: Sparkles,
    tone: "from-pink-500/20 to-violet-500/5",
  },
  {
    eyebrow: "TALK",
    title: "대화가 성장으로 남는 곳",
    body: "채팅, 음성·영상 통화, Talk to Earn 보상이 일상의 대화를 다음 성장으로 이어줍니다.",
    icon: MessageCircle,
    tone: "from-cyan-500/20 to-blue-500/5",
  },
  {
    eyebrow: "GROWTH",
    title: "오늘의 미션과 토크배틀",
    body: "매일의 미션을 완료하고 토크배틀에 참여해 FAN XP와 STAR 성장 재료를 획득하세요.",
    icon: Target,
    tone: "from-amber-400/20 to-orange-500/5",
  },
];

const journey = [
  ["01", "홈", "오늘의 미션과 현재 성장 상태를 확인해요.", Sparkles],
  ["02", "검색", "STAR, 팬아트, 이야기와 새로운 프로필을 찾아요.", Search],
  ["03", "피드", "공개 성장 기록을 보고 응원과 반응을 남겨요.", LayoutGrid],
  ["04", "채팅", "관계가 이어지는 대화와 실시간 알림을 만나요.", MessageCircle],
  ["05", "미션", "토크배틀과 일일 미션으로 보상을 쌓아요.", Mic2],
  ["06", "마이", "프로필, 지갑, NFT STAR 소환과 설정을 관리해요.", Star],
] as const;

function FeaturePill({ children }: { children: string }) {
  return <span className="inline-flex items-center rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-xs font-bold text-violet-100">{children}</span>;
}

export default function Home() {
  const { isInstallable, isInstalled, promptInstall, platform } = usePwa();
  const [showManualInstall, setShowManualInstall] = useState(false);
  const installGuide = installGuides[platform] ?? installGuides.desktop;

  const openInstall = async () => {
    if (isInstallable && await promptInstall()) return;
    setShowManualInstall(true);
  };

  const Actions = ({ className = "" }: { className?: string }) => (
    <div className={`flex flex-col gap-3 sm:flex-row ${className}`}>
      <a href={appUrl}>
        <Button size="lg" className="h-14 w-full gap-2 px-7 text-base font-black text-white shadow-[0_0_38px_rgba(153,76,255,.35)] transition hover:-translate-y-0.5 hover:shadow-[0_0_50px_rgba(153,76,255,.55)] sm:w-auto">
          DavaQ 시작하기 <ArrowRight className="h-5 w-5" />
        </Button>
      </a>
      {!isInstalled ? (
        <Button size="lg" variant="ghost" onClick={openInstall} className="h-14 gap-2 px-5 text-base font-bold text-white/75 hover:bg-white/8 hover:text-white">
          <Download className="h-5 w-5" /> PWA 설치
        </Button>
      ) : null}
    </div>
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#030208] text-foreground selection:bg-violet-500/40">
      <nav className="glass-panel fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-white/[.07] px-5 py-3.5 md:px-10">
        <a href="#top" className="flex items-center gap-2.5" aria-label="DavaQ 홈">
          <img src={appIcon} alt="DavaQ 앱 아이콘" className="h-10 w-10 rounded-[0.78rem] shadow-[0_0_20px_rgba(160,86,255,.42)]" />
          <span className="hidden text-base font-black tracking-[-.03em] text-white sm:block">DavaQ</span>
        </a>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <a href="#experience" className="hidden rounded-lg px-3 py-2 text-white/60 hover:text-white md:block">서비스</a>
          <a href="#journey" className="hidden rounded-lg px-3 py-2 text-white/60 hover:text-white md:block">성장 여정</a>
          <a href={appUrl}><Button size="sm" className="font-bold text-white">앱 열기</Button></a>
        </div>
      </nav>

      <section id="top" className="relative isolate px-5 pb-20 pt-32 md:px-8 md:pb-28 md:pt-40">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[-18rem] top-[-10rem] h-[46rem] w-[46rem] rounded-full bg-violet-600/20 blur-[130px]" />
          <div className="absolute right-[-18rem] top-24 h-[40rem] w-[40rem] rounded-full bg-fuchsia-600/15 blur-[150px]" />
          <div className="absolute inset-x-0 bottom-0 h-80 bg-[linear-gradient(180deg,transparent,rgba(3,2,8,.94))]" />
        </div>

        <div className="container mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[.95fr_1.05fr]">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-500/10 px-4 py-2 text-sm font-bold text-violet-100">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,.9)]" />
              캐릭터와 관계가 함께 성장하는 소셜 월드
            </div>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-[clamp(3rem,6vw,5.6rem)] font-black leading-[.98] tracking-[-.065em] text-white [word-break:keep-all]">
                나로 시작해,<br />
                <span className="text-gradient text-glow-purple">또 다른 나</span>로 성장하세요.
              </h1>
              <p className="max-w-xl text-lg leading-8 text-white/65 md:text-xl">
                DavaQ는 캐릭터 프로필, 피드, 채팅, 일일 미션과 토크배틀을 하나의 성장 경험으로 연결합니다. FAN의 응원이 STAR의 이야기로 이어지는 세계를 만나보세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <FeaturePill>FAN / STAR 프로필</FeaturePill><FeaturePill>실시간 채팅·통화</FeaturePill><FeaturePill>일일 미션</FeaturePill><FeaturePill>성장 RPG</FeaturePill>
            </div>
            <Actions />
          </div>

          <div className="relative mx-auto w-full max-w-[440px]">
            <div className="absolute inset-x-[8%] bottom-[-2.5rem] h-24 rounded-full bg-violet-600/30 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2.35rem] border border-violet-300/35 bg-[#07050f] p-2.5 shadow-[0_28px_90px_rgba(0,0,0,.65),0_0_55px_rgba(130,63,255,.18)]">
              <div className="absolute inset-x-[33%] top-2 z-10 h-1.5 rounded-full bg-black/80" />
              <img src={appServicePreview} alt="DavaQ 현재 서비스 화면" className="block w-full rounded-[1.8rem]" />
            </div>
            <div className="absolute -bottom-4 -left-9 rounded-2xl border border-violet-200/20 bg-[#160c31]/95 px-4 py-3 shadow-xl backdrop-blur-xl">
              <p className="text-xs font-black text-violet-200">ANOTHER ME APP</p>
              <p className="mt-1 text-sm font-bold text-white">지금 서비스 화면을 만나보세요</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-5 pb-16 md:px-8"><div className="container mx-auto grid max-w-7xl gap-3 md:grid-cols-3">
        {[['FAN에서 시작', '프로필을 만들고 관계와 스탯을 성장시켜요.'], ['STAR로 확장', 'NFT STAR를 소환·장착해 새로운 미션을 열어요.'], ['기록으로 증명', '피드와 공개 활동으로 나만의 이야기를 남겨요.']].map(([title, body]) => <div key={title} className="glass-card rounded-3xl p-6"><p className="text-lg font-black text-white">{title}</p><p className="mt-2 text-sm leading-6 text-white/55">{body}</p></div>)}
      </div></section>

      <section id="experience" className="px-5 py-20 md:px-8 md:py-28"><div className="container mx-auto max-w-7xl">
        <div className="mb-11 max-w-2xl"><p className="text-sm font-black tracking-[.22em] text-violet-300">ANOTHER ME EXPERIENCE</p><h2 className="mt-4 text-4xl font-black leading-tight text-white md:text-6xl">매일의 활동이<br />나만의 세계가 됩니다.</h2><p className="mt-5 text-lg leading-8 text-white/55">보는 것에서 끝나지 않고, 관계를 만들고 대화하고 미션을 완료할수록 캐릭터가 달라집니다.</p></div>
        <div className="grid gap-4 md:grid-cols-2">{experiences.map((item) => { const Icon = item.icon; return <article key={item.title} className={`group relative overflow-hidden rounded-[1.8rem] border border-white/10 bg-gradient-to-br ${item.tone} p-7 transition hover:-translate-y-1 hover:border-violet-300/45`}><div className="absolute -right-8 -top-8 h-36 w-36 rounded-full bg-violet-400/10 blur-2xl" /><Icon className="relative h-8 w-8 text-violet-200" /><p className="relative mt-7 text-xs font-black tracking-[.18em] text-violet-300">{item.eyebrow}</p><h3 className="relative mt-2 text-2xl font-black text-white">{item.title}</h3><p className="relative mt-3 max-w-md leading-7 text-white/60">{item.body}</p></article>; })}</div>
      </div></section>

      <section id="journey" className="relative overflow-hidden border-y border-white/[.06] bg-[#070411] px-5 py-20 md:px-8 md:py-28"><div className="container mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-sm font-black tracking-[.22em] text-cyan-300">YOUR DAILY LOOP</p><h2 className="mt-4 text-4xl font-black leading-tight text-white md:text-5xl">여섯 개의 탭,<br />하나의 성장 흐름.</h2><p className="mt-5 max-w-md text-lg leading-8 text-white/55">홈에서 시작해 발견하고, 연결하고, 도전하고, 나를 관리하는 흐름이 자연스럽게 이어집니다.</p><a href={appUrl} className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-violet-200 hover:text-white">앱에서 성장 흐름 보기 <ExternalLink className="h-4 w-4" /></a></div>
          <div className="grid gap-3 sm:grid-cols-2">{journey.map(([number, title, body, Icon]) => <div key={number} className="rounded-3xl border border-white/[.09] bg-white/[.025] p-5"><div className="flex items-center justify-between"><span className="text-xs font-black text-violet-300">{number}</span><Icon className="h-5 w-5 text-white/45" /></div><h3 className="mt-7 text-xl font-black text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-white/50">{body}</p></div>)}</div>
        </div>
      </div></section>

      <section className="px-5 py-24 md:px-8"><div className="container mx-auto max-w-6xl overflow-hidden rounded-[2.4rem] border border-violet-300/20 bg-[radial-gradient(circle_at_72%_20%,rgba(170,83,255,.3),transparent_35%),linear-gradient(120deg,rgba(38,16,79,.9),rgba(9,5,24,.94))] p-8 text-center md:p-16"><ShieldCheck className="mx-auto h-11 w-11 text-violet-200" /><h2 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">오늘의 대화가<br /><span className="text-gradient">내일의 DavaQ</span>가 됩니다.</h2><p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/60">지금 FAN 캐릭터를 만들고, 새로운 STAR와 이야기를 시작해 보세요.</p><Actions className="mt-10 justify-center" /></div></section>

      <footer className="border-t border-white/[.07] px-6 py-9 text-white/45"><div className="container mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row"><span className="text-xl font-black tracking-tight">DavaQ</span><p className="text-sm">© 2026 DavaQ. Grow your story.</p></div></footer>

      <Dialog open={showManualInstall} onOpenChange={setShowManualInstall}><DialogContent className="glass-panel border-white/20 bg-[#0b0719]/95 text-white shadow-2xl backdrop-blur-3xl sm:max-w-md"><DialogHeader><DialogTitle className="text-2xl font-black">{installGuide.title}</DialogTitle><DialogDescription className="text-base text-white/60">{installGuide.description}</DialogDescription></DialogHeader><div className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-white/[.04] p-5">{installGuide.steps.map((step, index) => <p key={step} className="flex items-start gap-3 text-sm leading-6 text-white/75"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/25 text-xs font-black text-violet-100">{index + 1}</span>{step}</p>)}</div><DialogFooter><Button onClick={() => setShowManualInstall(false)} className="h-11 w-full font-bold text-white"><Check className="mr-2 h-4 w-4" />확인</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}
