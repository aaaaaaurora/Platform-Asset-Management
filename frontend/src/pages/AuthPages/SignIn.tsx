import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="Asset Management"
        description="Piattaforma di Asset Management per l'Università degli Studi di Salerno"
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}