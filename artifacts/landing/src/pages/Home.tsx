import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  Headphones,
  ImagePlus,
  MapPin,
  MessageCircle,
  Repeat2,
  ScanLine,
  ShieldCheck,
  Armchair,
  WandSparkles,
} from "lucide-react";
import "./davaq.css";

const start = "/app/wishes/new";

function QAvatar({ small = false }: { small?: boolean }) {
  return (
    <span
      className={"dq-q" + (small ? " dq-q-small" : "")}
      aria-label="AI 도우미 Q"
    >
      Q<span />
    </span>
  );
}

function WishPreview() {
  return (
    <div className="dq-preview" aria-label="사진으로 소원을 만드는 기능 예시">
      <div className="dq-preview-top">
        <span>
          <ScanLine size={17} /> 갖고 싶은 것에서 시작
        </span>
        <span className="dq-example">화면 예시</span>
      </div>
      <div className="dq-product">
        <div className="dq-product-caption">
          <span>내 소원함</span>
          <span>
            <ShieldCheck size={13} /> 나만 보기
          </span>
        </div>
        <div className="dq-headphones">
          <Headphones size={144} strokeWidth={1.15} aria-hidden="true" />
        </div>
        <div className="dq-product-name">
          <div>
            <small>내가 갖고 싶은 것</small>
            <strong>무선 헤드폰</strong>
          </div>
          <span className="dq-product-tag">물건</span>
        </div>
      </div>
      <div className="dq-preview-question">
        <Camera size={22} />
        <span>
          안 쓰는 <strong>카메라</strong>로 바꿀 수 있을까?
        </span>
      </div>
      <div className="dq-q-reply">
        <QAvatar small />
        <p>
          직접 맞는 상대부터,
          <br />
          <strong>여러 사람이 이어지는 교환까지 찾아봐요.</strong>
        </p>
      </div>
      <div className="dq-preview-foot">
        <span>사진·설명 보내기</span>
        <ArrowRight size={14} />
        <span>내가 확인하고 저장</span>
      </div>
    </div>
  );
}

function ExchangeDemo() {
  const [relay, setRelay] = useState(true);
  const people = relay
    ? [
        { name: "나", give: "카메라", receive: "헤드폰", icon: Camera },
        {
          name: "이웃 A",
          give: "캠핑 의자",
          receive: "카메라",
          icon: Armchair,
        },
        {
          name: "이웃 B",
          give: "헤드폰",
          receive: "캠핑 의자",
          icon: Headphones,
        },
      ]
    : [
        { name: "나", give: "카메라", receive: "헤드폰", icon: Camera },
        { name: "이웃", give: "헤드폰", receive: "카메라", icon: Headphones },
      ];
  return (
    <div className="dq-exchange-demo">
      <div className="dq-demo-toolbar">
        <div
          className="dq-switch"
          role="group"
          aria-label="교환 방식 예시 선택"
        >
          <button
            type="button"
            aria-pressed={!relay}
            onClick={() => setRelay(false)}
          >
            직접 바꾸기
          </button>
          <button
            type="button"
            aria-pressed={relay}
            onClick={() => setRelay(true)}
          >
            이어 바꾸기
          </button>
        </div>
        <span className="dq-example">이해를 돕기 위한 예시</span>
      </div>
      <div className="dq-demo-content" aria-live="polite" aria-atomic="true">
        <p className="dq-demo-intro">
          {relay
            ? "내 카메라를 원하는 사람과, 헤드폰을 가진 사람이 달라도 괜찮아요."
            : "서로 원하는 것이 맞으면, 두 사람이 바로 바꿔요."}
        </p>
        <div className={"dq-chain" + (!relay ? " dq-chain-direct" : "")}>
          {people.map(({ name, give, receive, icon: Icon }, i) => (
            <div className="dq-chain-part" key={name}>
              <div className={"dq-person" + (i === 0 ? " dq-person-me" : "")}>
                <div className="dq-person-name">
                  <span>{name}</span>
                  {i === 0 && <span className="dq-you">내 교환</span>}
                </div>
                <div className="dq-item-icon">
                  <Icon size={42} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <small>주는 것</small>
                <strong>{give}</strong>
                <div className="dq-receive">
                  <ArrowDown size={14} /> 받는 것 <b>{receive}</b>
                </div>
              </div>
              {i < people.length - 1 && (
                <div className="dq-chain-arrow" aria-label={give + " 전달"}>
                  <ArrowRight size={23} />
                  <span>{give}</span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="dq-return">
          <Repeat2 size={19} />
          <span>
            {relay
              ? "이웃 B의 헤드폰은 나에게. 세 사람의 교환이 이어져요."
              : "카메라는 이웃에게, 헤드폰은 나에게."}
          </span>
        </div>
        <p className="dq-demo-note">
          {relay
            ? "중간 물건을 받아 다시 바꿀 필요 없이, 각자 정해진 상대에게 전달해요. 실제 기능은 3~4명 연결을 찾아요."
            : "물건뿐 아니라 재능·서비스·경험도 서로의 조건이 맞으면 교환할 수 있어요."}
        </p>
      </div>
    </div>
  );
}

function MapPreview() {
  return (
    <div
      className="dq-map-preview"
      role="img"
      aria-label="근처 물건과 만날 장소를 표시하는 지도 기능 예시. 실제 위치가 아닙니다."
    >
      <div className="dq-map-park" />
      <div className="dq-map-water" />
      <div className="dq-road dq-road-a" />
      <div className="dq-road dq-road-b" />
      <div className="dq-road dq-road-c" />
      <span className="dq-map-pin dq-pin-camera">
        <Camera size={19} /> 카메라
      </span>
      <span className="dq-map-pin dq-pin-headphones">
        <Headphones size={19} /> 헤드폰
      </span>
      <span className="dq-map-meet">
        <MapPin size={16} /> 만날 장소 함께 정하기
      </span>
      <span className="dq-map-label">지도 기능 예시 · 실제 위치 아님</span>
    </div>
  );
}

const questions = [
  {
    question: "지금 맞는 상대가 없으면 어떻게 하나요?",
    answer:
      "원하는 것을 소원함에 남겨두세요. 내가 제공할 수 있는 물건이나 재능을 등록하고 자동 매칭을 켜면, 새 교환 후보가 발견됐을 때 Q 대화에서 확인할 수 있어요. 후보와 성사 여부는 실제 등록과 참여자들의 조건에 따라 달라져요.",
  },
  {
    question: "소원과 캡처 사진은 누구에게 보이나요?",
    answer:
      "소원함과 참고 사진은 나만 볼 수 있어요. ‘Q로 정리하기’를 누르면 설명과 사진을 AI가 분석하고, 저장 전에 직접 수정할 수 있어요. 교환을 제안한 뒤에는 참여자들이 주고받을 항목과 제안 조건을 확인해요.",
  },
  {
    question: "Q가 제 마음대로 교환을 확정하나요?",
    answer:
      "Q는 후보를 찾아주는 역할이에요. 제안 전송과 교환 동의는 직접 해야 해요. 여러 사람이 이어 바꾸는 경우에도 모든 참여자가 같은 조건에 동의해야 교환이 확정돼요.",
  },
];

export default function Home() {
  return (
    <div className="dq-site">
      <a className="dq-skip" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="dq-nav dq-shell">
        <a href="/" className="dq-brand" aria-label="DavaQ 다바꿔 홈">
          DavaQ<span>다바꿔</span>
        </a>
        <nav aria-label="주요 메뉴">
          <a className="dq-nav-section" href="#how">
            시작하는 방법
          </a>
          <a className="dq-nav-section" href="#relay">
            이어 바꾸기
          </a>
          <a className="dq-nav-section" href="#nearby">
            지도와 채팅
          </a>
          <a href="/app/" className="dq-nav-app">
            앱 열기 <ArrowUpRight size={16} />
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="dq-hero dq-shell" aria-labelledby="hero-title">
          <div className="dq-hero-copy">
            <div className="dq-eyebrow">
              <span className="dq-dot" /> 물건 · 재능 · 경험을 교환하는 방법
            </div>
            <h1 id="hero-title">
              사기 전에,
              <br />
              가진 것으로
              <br />
              <em>바꿔보세요.</em>
            </h1>
            <p className="dq-lead">
              갖고 싶은 것을 보여주세요.
              <br />
              Q가 내 물건과 재능으로
              <br className="dq-mobile-break" /> 교환할 방법을 찾아줘요.
            </p>
            <div className="dq-hero-actions">
              <a className="dq-primary" href={start}>
                갖고 싶은 것 Q에게 보내기 <ArrowUpRight size={20} />
              </a>
              <a className="dq-text-link" href="#how">
                어떻게 바꾸나요? <ArrowDown size={16} />
              </a>
            </div>
            <p className="dq-caption">
              설치 없이, 모바일과 PC에서 바로 시작하세요.
            </p>
          </div>
          <WishPreview />
        </section>
        <section
          id="how"
          className="dq-section dq-shell"
          aria-labelledby="how-title"
        >
          <div className="dq-section-heading">
            <div>
              <div className="dq-eyebrow">소원에서 교환으로</div>
              <h2 id="how-title">
                원하는 것 하나면,
                <br />
                시작할 수 있어요.
              </h2>
            </div>
            <p>
              사진 한 장으로 시작해서,
              <br />
              내가 줄 것과 받을 것을 함께 확인해요.
            </p>
          </div>
          <ol className="dq-steps">
            {[
              {
                icon: ImagePlus,
                title: "갖고 싶은 것을 담아요",
                body: "상품 캡처나 사진, 짧은 설명을 보내세요. Q가 정리한 초안을 확인하고 내 소원함에 저장해요.",
              },
              {
                icon: Camera,
                title: "내가 줄 수 있는 것을 등록해요",
                body: "안 쓰는 물건, 자신 있는 재능, 나눌 수 있는 경험. 내가 제공할 수 있는 것이 교환의 출발점이에요.",
              },
              {
                icon: WandSparkles,
                title: "이어지는 방법을 찾아요",
                body: "직접 교환과 여러 사람이 이어 바꾸는 후보를 살펴봐요. 줄 것·받을 것·확인할 조건을 먼저 보여드려요.",
              },
            ].map(({ icon: Icon, title, body }, i) => (
              <li key={title}>
                <div className="dq-step-top">
                  <Icon size={24} strokeWidth={1.6} />
                  <span>0{i + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section
          id="relay"
          className="dq-relay-section"
          aria-labelledby="relay-title"
        >
          <div className="dq-shell">
            <div className="dq-section-heading">
              <div>
                <div className="dq-eyebrow">Q의 이어 바꾸기</div>
                <h2 id="relay-title">
                  둘이 안 맞으면,
                  <br />한 사람 더 이어서.
                </h2>
              </div>
              <p>
                내 물건을 원하는 사람을 거쳐,
                <br />
                내가 원하는 물건을 가진 사람까지.
                <br />
                Q가 함께 바꿀 수 있는 연결을 찾아요.
              </p>
            </div>
            <ExchangeDemo />
            <div className="dq-section-bottom">
              <span>
                <ShieldCheck size={18} /> 모든 참여자가 조건에 동의해야 교환이
                확정돼요.
              </span>
              <a className="dq-text-link" href="/app/relay">
                이어 바꾸기 살펴보기 <ArrowUpRight size={17} />
              </a>
            </div>
          </div>
        </section>
        <section
          id="nearby"
          className="dq-section dq-shell"
          aria-labelledby="nearby-title"
        >
          <div className="dq-section-heading">
            <div>
              <div className="dq-eyebrow">발견한 다음도, 한곳에서</div>
              <h2 id="nearby-title">
                어디에 있는지 보고,
                <br />
                어떻게 바꿀지 이야기해요.
              </h2>
            </div>
          </div>
          <div className="dq-feature-grid">
            <article className="dq-feature">
              <MapPreview />
              <div className="dq-feature-copy">
                <span className="dq-feature-kicker">
                  <MapPin size={16} /> 교환 지도
                </span>
                <h3>내 주변에 있는 원하는 것</h3>
                <p>
                  공개된 대략적인 위치로 근처 물건을 찾고,
                  <br className="dq-desktop-break" /> 구체적인 만날 장소는
                  참여자끼리 정해요.
                </p>
                <a className="dq-text-link" href="/app/map">
                  지도에서 찾아보기 <ArrowUpRight size={17} />
                </a>
              </div>
            </article>
            <article className="dq-feature">
              <div className="dq-chat-preview" aria-label="교환 채팅 예시">
                <div className="dq-chat-title">
                  <MessageCircle size={19} />
                  <strong>우리의 교환 이야기</strong>
                  <span className="dq-example">대화 예시</span>
                </div>
                <div className="dq-bubble">카메라 구성품이 모두 있나요?</div>
                <div className="dq-bubble dq-bubble-mine">
                  네! 구성품 사진도 보내드릴게요.
                </div>
                <div className="dq-bubble">
                  토요일 오후, 역 앞에서 어떠세요?
                </div>
                <div className="dq-chat-check">
                  <Check size={15} /> 확인한 조건으로, 서로 동의한 뒤 교환
                </div>
              </div>
              <div className="dq-feature-copy">
                <span className="dq-feature-kicker">
                  <MessageCircle size={16} /> DavaQ 메신저
                </span>
                <h3>채팅으로 확인하고 함께 결정</h3>
                <p>
                  사진과 대화로 상태·구성·일정을 확인하세요.
                  <br className="dq-desktop-break" /> 필요하면 음성·영상 통화로
                  더 자세히 이야기해요.
                </p>
                <a className="dq-text-link" href="/app/chats">
                  메신저 열기 <ArrowUpRight size={17} />
                </a>
              </div>
            </article>
          </div>
        </section>
        <section className="dq-shell" aria-labelledby="q-title">
          <div className="dq-agent-section">
            <div>
              <div className="dq-eyebrow">기다리는 동안에도, Q</div>
              <h2 id="q-title">
                소원은 남겨두고,
                <br />새 연결은 Q에게 받으세요.
              </h2>
              <p>
                내 AI에서 자동 매칭을 켜두면,
                <br />
                새로운 교환 후보를 찾았을 때 Q 대화로 알려줘요.
              </p>
              <a href="/app/wishes" className="dq-agent-link">
                내 소원함 열기 <ArrowUpRight size={18} />
              </a>
            </div>
            <div className="dq-agent-example">
              <div className="dq-notification">
                <QAvatar />
                <div>
                  <div className="dq-notification-title">
                    <strong>나의 Q</strong>
                    <span>알림 예시</span>
                  </div>
                  <p>
                    소원으로 이어지는
                    <br />
                    <strong>새 교환 후보를 찾았어요.</strong>
                  </p>
                  <span className="dq-notification-action">
                    내가 줄 것 · 받을 것 확인하기 <ArrowRight size={15} />
                  </span>
                </div>
              </div>
              <p className="dq-agent-note">추천은 Q가, 제안과 결정은 내가.</p>
            </div>
          </div>
        </section>
        <section className="dq-faq dq-shell" aria-labelledby="faq-title">
          <h2 id="faq-title">시작하기 전에 궁금한 것</h2>
          <div>
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={19} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="dq-final dq-shell">
          <span className="dq-eyebrow">나의 첫 소원</span>
          <h2>
            사고 싶던 그 물건,
            <br />
            <em>Q에게 보여주세요.</em>
          </h2>
          <a className="dq-primary" href={start}>
            갖고 싶은 것 Q에게 보내기 <ArrowUpRight size={20} />
          </a>
          <p>사진이나 설명을 보내고, 초안을 확인하면 시작이에요.</p>
        </section>
      </main>
      <footer className="dq-footer dq-shell">
        <a href="/" className="dq-brand">
          DavaQ<span>다바꿔</span>
        </a>
        <span>갖고 싶은 것과, 내가 가진 것을 잇다.</span>
        <span>© {new Date().getFullYear()} DavaQ</span>
      </footer>
    </div>
  );
}
