import { useRef, useState } from "react";
import { SiAndroid, SiApple } from "react-icons/si";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Heart,
  Layers,
  MessageCircle,
  Plus,
  ScanLine,
  Search,
  Smartphone,
  Sparkles,
} from "lucide-react";
import "./davaq.css";

const media = "/media/landing-20261015/";
const links = {
  start: "/app/",
  price: "/app/agent",
  feed: "/app/search",
  collection: "/app/exchanges",
  ios: "https://testflight.apple.com/join/szwESrhZ",
  android: "/downloads/DavaQ-1.0.0-37.apk",
  androidTest: "https://play.google.com/apps/internaltest/4700858542884065904",
};
function DownloadButtons() {
  return (
    <div className="dq-download-buttons" aria-label="DAVAQ 앱 다운로드">
      <a
        className="dq-download-button"
        href={links.ios}
        target="_blank"
        rel="noreferrer"
      >
        <SiApple size={27} aria-hidden="true" />
        <span>
          <small>TestFlight 베타</small>
          <strong>iPhone 다운로드</strong>
        </span>
        <ArrowUpRight size={18} aria-hidden="true" />
      </a>
      <a
        className="dq-download-button"
        href={links.android}
        download="DavaQ-1.0.0-37.apk"
      >
        <SiAndroid size={27} aria-hidden="true" />
        <span>
          <small>Android APK · 1.0.0 (37)</small>
          <strong>Android 다운로드</strong>
        </span>
        <ArrowDown size={18} aria-hidden="true" />
      </a>
    </div>
  );
}
const cardIds = [
  "kream:649512",
  "kream:649349",
  "kream:803217",
  "kream:959332",
  "kream:651518",
  "kream:651523",
];
const cardFeedLink = (index: number) =>
  `${links.feed}?cardId=${encodeURIComponent(cardIds[index])}`;
const cards = [
  {
    image: "card-pikachu.webp",
    name: "피카츄 ex",
    detail: "초전브레이커 · SAR · 일본어판",
    alt: "포켓몬 TCG 피카츄 ex SAR 초전브레이커 일본어판 카드",
  },
  {
    image: "card-glaceon.webp",
    name: "글레이시아 ex",
    detail: "테라스탈 페스타 ex · SAR · 일본어판",
    alt: "포켓몬 TCG 글레이시아 ex SAR 테라스탈 페스타 일본어판 카드",
  },
  {
    image: "card-sylveon.webp",
    name: "님피아 ex",
    detail: "테라스탈 페스타 ex · SAR · 한글판",
    alt: "포켓몬 TCG 님피아 ex SAR 테라스탈 페스타 한글판 카드",
  },
  {
    image: "card-umbreon.webp",
    name: "블래키 ex",
    detail: "테라스탈 페스타 ex · SAR · 한글판",
    alt: "포켓몬 TCG 블래키 ex SAR 테라스탈 페스타 한글판 카드",
  },
  {
    image: "card-charmander.webp",
    name: "파이리",
    detail: "포켓몬 카드 151 · AR · 일본어판",
    alt: "포켓몬 TCG 파이리 AR 포켓몬 카드 151 일본어판 카드",
  },
  {
    image: "card-pikachu-151.webp",
    name: "피카츄",
    detail: "포켓몬 카드 151 · AR · 일본어판",
    alt: "포켓몬 TCG 피카츄 AR 포켓몬 카드 151 일본어판 카드",
  },
];
function CardImage({
  index,
  className = "",
  eager = false,
}: {
  index: number;
  className?: string;
  eager?: boolean;
}) {
  const card = cards[index];
  return (
    <img
      className={className}
      src={media + card.image}
      alt={card.alt}
      width="312"
      height="432"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
function FeedPreview() {
  const [active, setActive] = useState(0);
  const [liked, setLiked] = useState<number[]>([]);
  const viewport = useRef<HTMLDivElement>(null);
  const order = [3, 0, 2];
  const move = (direction: number) => {
    const target = Math.max(0, Math.min(order.length - 1, active + direction));
    const pane = viewport.current;
    if (pane)
      pane.scrollTo({
        top: target * pane.clientHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  };
  return (
    <div className="dq-feed-demo">
      <div className="dq-feed-phone">
        <div className="dq-phone-bar">
          <span>DAVAQ</span>
          <span>FEED PREVIEW</span>
          <Layers size={17} aria-hidden="true" />
        </div>
        <div
          className="dq-feed-viewport"
          ref={viewport}
          tabIndex={0}
          aria-label="카드 피드 미리보기. 위아래로 넘기거나 방향키로 탐색하세요."
          onScroll={(event) => {
            const pane = event.currentTarget;
            setActive(Math.round(pane.scrollTop / pane.clientHeight));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            }
          }}
        >
          {order.map((index, position) => (
            <article
              className="dq-feed-slide"
              key={cards[index].image}
              aria-label={cards[index].name}
            >
              <CardImage index={index} className="dq-feed-art" />
              <div className="dq-feed-shade" />
              <div className="dq-feed-actions">
                <button
                  type="button"
                  aria-label={`${cards[index].name} 미리보기 좋아요`}
                  aria-pressed={liked.includes(position)}
                  onClick={() =>
                    setLiked((before) =>
                      before.includes(position)
                        ? before.filter((i) => i !== position)
                        : [...before, position],
                    )
                  }
                >
                  <Heart
                    size={25}
                    fill={liked.includes(position) ? "currentColor" : "none"}
                  />
                  <span>좋아요</span>
                </button>
                <a
                  href={cardFeedLink(index)}
                  aria-label={`${cards[index].name} 카드 피드에서 댓글 남기기`}
                >
                  <MessageCircle size={25} />
                  <span>댓글</span>
                </a>
                <a
                  href={cardFeedLink(index)}
                  aria-label={`${cards[index].name} 카드 피드에서 오퍼 보기`}
                >
                  <ArrowDownUp size={25} />
                  <span>오퍼</span>
                </a>
              </div>
              <div className="dq-feed-description">
                <span className="dq-feed-tag">발견한 카드</span>
                <h3>{cards[index].name}</h3>
                <p>{cards[index].detail}</p>
                <a className="dq-feed-register" href={cardFeedLink(index)}>
                  <Plus size={17} /> 이 카드 가지고 있어요{" "}
                  <ArrowUpRight size={17} />
                </a>
              </div>
            </article>
          ))}
        </div>
        <div className="dq-phone-tabs">
          <span>
            <Search size={17} />
            탐색
          </span>
          <span className="dq-selected">
            <ArrowDownUp size={17} />
            교환
          </span>
          <span>
            <MessageCircle size={17} />
            채팅
          </span>
          <span>
            <Layers size={17} />
            컬렉션
          </span>
        </div>
      </div>
      <div className="dq-feed-control">
        <span aria-live="polite">
          0{active + 1} <span>/ 0{order.length}</span>
        </span>
        <div>
          <button
            type="button"
            onClick={() => move(-1)}
            disabled={active === 0}
            aria-label="이전 카드 보기"
          >
            <ArrowUp size={20} />
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            disabled={active === order.length - 1}
            aria-label="다음 카드 보기"
          >
            <ArrowDown size={20} />
          </button>
        </div>
      </div>
      <p className="dq-demo-note">
        실제 카드 이미지로 구성한 기능 미리보기입니다.
      </p>
    </div>
  );
}
export default function Home() {
  return (
    <div className="davaq-site">
      <a className="dq-skip" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="dq-header">
        <a className="dq-wordmark" href="/" aria-label="DavaQ 다바꿔 홈">
          DAVAQ<span>다바꿔</span>
        </a>
        <nav aria-label="서비스 소개">
          <a href="#price">가격 검색</a>
          <a href="#exchange">카드 교환</a>
          <a href="#feed">소통 피드</a>
        </nav>
        <a className="dq-nav-cta" href="#download">
          앱 다운로드 <ArrowDown size={17} />
        </a>
      </header>
      <main id="main">
        <section className="dq-hero dq-wrap" aria-labelledby="hero-title">
          <div className="dq-hero-copy">
            <p className="dq-kicker">
              <span className="dq-dot" /> THE COLLECTOR'S NEXT MOVE
            </p>
            <h1 id="hero-title">
              찾고. 바꾸고.
              <br />
              <span>빠져들고.</span>
            </h1>
            <p className="dq-hero-body">
              GPT보다 빠른 카드 시세 검색부터
              <br className="dq-desktop-break" /> 내 카드로 시작하는 교환,
              취향이 통하는 피드까지.
            </p>
            <a className="dq-button dq-button-black" href={links.feed}>
              카드 피드 둘러보기 <ArrowUpRight size={21} />
            </a>
            <a className="dq-hero-text-link" href="#price">
              DAVAQ 더 알아보기 <ArrowDown size={15} />
            </a>
            <DownloadButtons />
            <a className="dq-install-guide-link" href="#download">
              베타 앱 설치 방법 보기
            </a>
            <div className="dq-hero-foot">
              <span>LESS SEARCHING.</span>
              <span>MORE COLLECTING.</span>
            </div>
          </div>
          <div
            className="dq-hero-gallery"
            aria-label="실제 카탈로그 카드: 글레이시아 ex, 피카츄 ex, 님피아 ex"
          >
            <div className="dq-gallery-label">
              <span>
                GOOD CARDS.
                <br />
                GOOD PEOPLE.
              </span>
              <Sparkles size={24} aria-hidden="true" />
            </div>
            <div className="dq-gallery-orbit" aria-hidden="true" />
            <CardImage index={1} className="dq-hero-card dq-card-left" eager />
            <CardImage index={2} className="dq-hero-card dq-card-right" eager />
            <CardImage index={0} className="dq-hero-card dq-card-front" eager />
            <div className="dq-gallery-caption">
              <ArrowDownUp size={17} />
              <span>내 카드의 다음 이야기를 만나세요.</span>
            </div>
            <span className="dq-gallery-index" aria-hidden="true">
              COLLECTION / 001
            </span>
          </div>
        </section>
        <div className="dq-game-band" aria-label="다양한 TCG 카드 탐색">
          <span>POKÉMON</span>
          <i />
          <span>ONE PIECE</span>
          <i />
          <span>MAGIC</span>
          <i />
          <span>YU-GI-OH!</span>
          <i />
          <span>RIFTBOUND</span>
        </div>
        <section
          className="dq-price dq-wrap dq-section"
          id="price"
          aria-labelledby="price-title"
        >
          <div className="dq-price-visual">
            <img
              src={media + "scan-promo.webp"}
              width="768"
              height="1152"
              loading="lazy"
              decoding="async"
              alt="GPT보다 빠른 카드 시세 확인을 소개하는 DAVAQ 스토어 홍보 이미지. 카드를 스마트폰으로 스캔하는 연출."
            />
            <span className="dq-image-caption">
              DAVAQ STORE CAMPAIGN · 스캔 연출 이미지
            </span>
          </div>
          <div className="dq-feature-copy">
            <p className="dq-kicker">01 / FIND YOUR CARD</p>
            <h2 id="price-title">
              이 카드, 얼마지?
              <br />
              <span className="dq-muted">답을 더 빠르게.</span>
            </h2>
            <p className="dq-lead">GPT보다 빠른 카드 시세 검색.</p>
            <p className="dq-description">
              길게 설명할 필요 없이, 이름으로 찾거나 카드를 스캔하세요. 카드
              정보와 참고 가격을 한곳에서 확인하고 다음 교환을 준비하세요.
            </p>
            <div className="dq-search-example" aria-label="카드 이름 검색 예시">
              <Search size={20} />
              <span>피카츄 ex SAR</span>
              <ArrowUpRight size={19} />
            </div>
            <ul className="dq-feature-list">
              <li>
                <ScanLine size={20} />
                <span>카메라로 카드 찾기</span>
                <Check size={16} />
              </li>
              <li>
                <Search size={20} />
                <span>이름·판본으로 정확하게 검색</span>
                <Check size={16} />
              </li>
              <li>
                <Layers size={20} />
                <span>카드 정보와 참고 시세를 함께</span>
                <Check size={16} />
              </li>
            </ul>
            <a className="dq-text-link" href={links.price}>
              카드 가격 찾아보기 <ArrowUpRight size={19} />
            </a>
          </div>
        </section>
        <section
          className="dq-exchange"
          id="exchange"
          aria-labelledby="exchange-title"
        >
          <div className="dq-wrap">
            <div className="dq-exchange-intro">
              <div>
                <p className="dq-kicker">02 / TRADE WHAT YOU LOVE</p>
                <h2 id="exchange-title">
                  내 카드로,
                  <br />
                  원하던 그 카드를.
                </h2>
              </div>
              <div className="dq-exchange-copy">
                <p>
                  나에게 두 장인 카드가
                  <br />
                  누군가에겐 마지막 한 장일 테니까.
                </p>
                <a className="dq-text-link" href={links.collection}>
                  내 카드로 교환 시작 <ArrowUpRight size={19} />
                </a>
              </div>
            </div>
            <figure className="dq-exchange-photo">
              <img
                src={media + "exchange-promo.webp"}
                width="1024"
                height="500"
                alt="실물 카드를 서로 건네는 장면과 내 카드로 원하는 카드를 문구가 담긴 DAVAQ 스토어 교환 홍보 이미지"
                loading="lazy"
                decoding="async"
              />
              <figcaption>
                최근 스토어 소개에 사용한 DAVAQ 교환 캠페인 이미지
              </figcaption>
            </figure>
            <div className="dq-trade-steps">
              <article>
                <span>01</span>
                <h3>내 카드를 올리고</h3>
                <p>
                  교환, 제안 받기, 무료 나눔.
                  <br />
                  원하는 방식으로 카드를 공개하세요.
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>마음에 드는 오퍼를 고르고</h3>
                <p>
                  같은 카드의 여러 오퍼를 모아 보고
                  <br />
                  나에게 맞는 조건을 선택하세요.
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>대화로 연결되세요</h3>
                <p>
                  카드 상태와 전달 방법을 확인하고
                  <br />
                  서로의 컬렉션을 완성하세요.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section
          className="dq-feed dq-wrap dq-section"
          id="feed"
          aria-labelledby="feed-title"
        >
          <div className="dq-feed-copy">
            <p className="dq-kicker">03 / SCROLL. DISCOVER. CONNECT.</p>
            <h2 id="feed-title">
              살 계획 없어도,
              <br />
              넘겨보는 재미.
            </h2>
            <p className="dq-description">
              한 장씩, 크게. 위로 넘길 때마다 새로운 카드가 나타나요. 취향에
              닿는 카드에서 좋아요를 누르고, 댓글로 이야기를 시작하세요.
            </p>
            <div className="dq-feed-benefits">
              <div>
                <span>01</span>
                <p>
                  <strong>등록하지 않아도, 바로 탐색</strong>오퍼가 없는
                  카드까지 전체 카탈로그에서 발견해요.
                </p>
              </div>
              <div>
                <span>02</span>
                <p>
                  <strong>보는 사람마다 새로운 순서</strong>내 피드를 둘러보고
                  새로고침하면 다시 새롭게.
                </p>
              </div>
              <div>
                <span>03</span>
                <p>
                  <strong>“나 이 카드 있는데!”</strong>발견한 카드에 내 오퍼를
                  올려 교환을 시작해요.
                </p>
              </div>
            </div>
            <a className="dq-button dq-button-black" href={links.feed}>
              내 취향의 카드 만나기 <ArrowUpRight size={20} />
            </a>
          </div>
          <FeedPreview />
        </section>
        <section className="dq-collection" aria-labelledby="collection-title">
          <div className="dq-wrap">
            <div className="dq-collection-heading">
              <p className="dq-kicker">EVERY CARD HAS A NEXT CHAPTER.</p>
              <h2 id="collection-title">
                다음 한 장은,
                <br />
                생각보다 가까이.
              </h2>
              <a className="dq-text-link" href={links.feed}>
                카드 둘러보기 <ArrowUpRight size={19} />
              </a>
            </div>
            <div className="dq-card-shelf">
              {[4, 1, 0, 3, 2, 5].map((index) => (
                <a
                  href={cardFeedLink(index)}
                  key={index}
                  aria-label={`${cards[index].name} 같은 카드 피드 둘러보기`}
                >
                  <CardImage index={index} />
                  <span>
                    {cards[index].name}
                    <ArrowUpRight size={14} />
                  </span>
                </a>
              ))}
            </div>
          </div>
        </section>
        <section className="dq-faq dq-wrap" aria-labelledby="faq-title">
          <div>
            <p className="dq-kicker">A FEW THINGS TO KNOW</p>
            <h2 id="faq-title">가볍게 시작하세요.</h2>
          </div>
          <div className="dq-faq-list">
            <details>
              <summary>
                카드를 먼저 등록해야 하나요?
                <ChevronDown size={20} />
              </summary>
              <p>
                아니요. 카드 등록 없이 피드를 둘러볼 수 있어요. 마음에 드는
                카드를 발견하면 오퍼를 확인하거나 내가 가진 카드를 등록해 교환을
                시작하세요.
              </p>
            </details>
            <details>
              <summary>
                교환 외에 무료 나눔도 가능한가요?
                <ChevronDown size={20} />
              </summary>
              <p>
                네. 내 카드를 교환용으로 공개하거나 제안을 받고, 무료 나눔으로
                올릴 수도 있어요. 실제 카드의 상태와 전달 방법은 상대방과 대화로
                확인하세요.
              </p>
            </details>
            <details>
              <summary>
                표시되는 가격은 어떤 가격인가요?
                <ChevronDown size={20} />
              </summary>
              <p>
                카드 정보와 참고 시세는 TCGIndex의 카탈로그 자료를 사용해요.
                판본과 카드 상태에 따라 실제 거래 조건은 달라질 수 있습니다.
              </p>
            </details>
            <details>
              <summary>
                어디에서 이용할 수 있나요?
                <ChevronDown size={20} />
              </summary>
              <p>
                PC와 모바일 브라우저에서 바로 시작할 수 있어요. 모바일에서는
                웹앱을 홈 화면에 추가할 수 있어요. 앱은 iPhone의 경우
                TestFlight, Android는 APK로 설치할 수 있습니다. 현재는 베타
                버전으로 제공해요.
              </p>
            </details>
          </div>
        </section>
        <section
          className="dq-final-cta"
          id="download"
          aria-labelledby="download-title"
        >
          <div className="dq-wrap">
            <p className="dq-kicker">YOUR NEXT CARD IS OUT THERE.</p>
            <h2 id="download-title">
              카드 한 장이,
              <br />
              새로운 연결이 되는 곳.
            </h2>
            <DownloadButtons />
            <div className="dq-install-guides">
              <div>
                <h3>iPhone · TestFlight로 설치</h3>
                <p>
                  다운로드 버튼에서 TestFlight를 받은 뒤, 같은 페이지의
                  ‘TestFlight에서 보기’를 눌러 DAVAQ를 설치하세요. 별도 초대
                  이메일 없이 참여할 수 있어요.
                </p>
              </div>
              <div>
                <h3>Android · APK로 설치</h3>
                <p>
                  Android 기기에서 APK 파일(약 141MB)을 내려받아 열어 주세요.
                  설치 시 해당 브라우저의 ‘이 출처 허용’ 안내가 표시될 수
                  있어요. Google Play로 설치한 테스터는 아래 테스트 페이지에서
                  업데이트해 주세요.
                </p>
                <a href={links.androidTest} target="_blank" rel="noreferrer">
                  Google Play 내부 테스트 페이지 <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
            <a className="dq-web-alternative" href={links.start}>
              <Smartphone size={17} /> 설치 없이 웹에서 시작하기{" "}
              <ArrowUpRight size={17} />
            </a>
            <div className="dq-big-wordmark" aria-hidden="true">
              DAVAQ
            </div>
          </div>
        </section>
      </main>
      <footer className="dq-footer dq-wrap">
        <div>
          <a className="dq-wordmark" href="/">
            DAVAQ
          </a>
          <p>찾고. 바꾸고. 빠져들고.</p>
        </div>
        <div className="dq-footer-links">
          <a href={links.start}>
            웹앱 열기 <ArrowUpRight size={15} />
          </a>
          <a href="https://tcgindex.org" target="_blank" rel="noreferrer">
            카드 데이터 · TCGIndex <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="dq-footer-bottom">
          <span>
            © {new Date().getFullYear()} DAVAQ. For the love of cards.
          </span>
          <p>
            카드 이미지와 명칭의 권리는 각 권리자에게 있습니다. DAVAQ는 카드
            발행사와 별개의 서비스입니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
