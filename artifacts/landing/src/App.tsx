import { Switch, Route, Router as WouterRouter } from "wouter";
import Home from "@/pages/Home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route>
        <main style={{ padding: "80px 24px", fontFamily: "sans-serif" }}>
          <h1>페이지를 찾을 수 없습니다.</h1>
          <a href="/">DAVAQ 홈으로 돌아가기</a>
        </main>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
    </WouterRouter>
  );
}

export default App;
