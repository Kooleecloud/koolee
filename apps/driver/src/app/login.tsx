import * as React from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { useSession } from "@/auth/session";
import { TurnstileWebView } from "@/auth/turnstile-webview";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Input,
  Label,
  Screen,
  Text,
} from "@/components/ui";
import { env } from "@/lib/env";

export default function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [captcha, setCaptcha] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const needsCaptcha = env.turnstileSiteKey.length > 0;

  async function submit() {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await signIn({
      email,
      password,
      ...(captcha ? { captchaToken: captcha } : {}),
    });
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen contentClassName="justify-center">
        <Text face="display" weight="semibold" className="text-3xl text-navy-800">
          Agent sign-in
        </Text>
        <Card>
          <CardHeader>
            <CardTitle>Sign in with your staff account</CardTitle>
            <CardDescription>
              Agent accounts are created by invitation only. If you don't have one, ask an
              admin to invite you.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <View className="gap-1.5">
              <Label>Email</Label>
              <Input
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                placeholder="you@koolee.cloud"
                testID="login-email"
                accessibilityLabel="Email"
              />
            </View>
            <View className="gap-1.5">
              <Label>Password</Label>
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                testID="login-password"
                accessibilityLabel="Password"
                onSubmitEditing={() => void submit()}
              />
            </View>
            {needsCaptcha ? <TurnstileWebView onToken={setCaptcha} /> : null}
            {error ? <FormMessage>{error}</FormMessage> : null}
            <Button
              size="lg"
              loading={busy}
              disabled={needsCaptcha && !captcha}
              onPress={() => void submit()}
            >
              Sign in
            </Button>
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                void WebBrowser.openBrowserAsync(`${env.apiUrl}/login/reset`)
              }
              className="self-center py-2"
            >
              <Text className="text-sm text-muted-foreground underline">
                Forgot your password?
              </Text>
            </Pressable>
          </CardContent>
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
