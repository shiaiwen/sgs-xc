import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="login-page">
      <div className="login-card">
        <p className="login-card__badge">仅限运营</p>
        <h1 className="login-card__title">小抄管理台</h1>
        <p className="login-card__lead">登录后查看并回复用户工单</p>
        <LoginForm />
      </div>
    </div>
  );
}