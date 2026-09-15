import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignUpForm from "../../components/auth/SignUpForm";

export default function SignUp() {
  return (
    <>
      <PageMeta
        title="Asset Management"
        description="Piattaforma di Asset Management per l'Università degli Studi di Salerno"
      />
      <AuthLayout>
        <SignUpForm />
      </AuthLayout>
    </>
  );
}
