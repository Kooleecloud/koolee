export { cn } from "./lib/utils";

export { Button, buttonVariants, type ButtonProps } from "./components/button";
export {
  Card,
  cardVariants,
  type CardProps,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "./components/card";
export { Input } from "./components/input";
export {
  PasswordField,
  type PasswordFieldProps,
} from "./components/password-field";
export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
} from "./components/popover";
export { Label } from "./components/label";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export {
  Avatar,
  avatarVariants,
  initialsFor,
  type AvatarProps,
} from "./components/avatar";
export { AvatarUploader, type AvatarUploaderProps } from "./components/avatar-uploader";
export {
  VerifiedIndicator,
  type VerifiedIndicatorProps,
} from "./components/verified-indicator";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
export { Toaster, toast } from "./components/sonner";
export { KooleeLogo, type KooleeLogoProps } from "./components/koolee-logo";

/* Marketing / brand system */
export {
  Section,
  SectionHeader,
  sectionVariants,
  type SectionProps,
  type SectionHeaderProps,
} from "./components/section";
export {
  CTAButton,
  ctaButtonVariants,
  type CTAButtonProps,
} from "./components/cta-button";
export {
  MarketingNav,
  type MarketingNavProps,
  type MarketingNavLink,
} from "./components/marketing-nav";
export {
  MarketingFooter,
  type MarketingFooterProps,
  type FooterLinkGroup,
} from "./components/marketing-footer";
export { StepCard, type StepCardProps } from "./components/step-card";
export { AirportCard, type AirportCardProps } from "./components/airport-card";
export {
  TripContrast,
  type TripContrastProps,
  type TripContrastColumn,
} from "./components/trip-contrast";
export { MilestoneTrack, type MilestoneTrackProps } from "./components/milestone-track";
export { CoverageScene, type CoverageSceneProps } from "./components/coverage-scene";
export {
  JourneyGlyph,
  type JourneyGlyphProps,
  type JourneyGlyphName,
} from "./components/journey-glyph";
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/accordion";
export {
  FAQAccordion,
  type FAQAccordionProps,
  type FAQItem,
} from "./components/faq-accordion";
export { StatBadge, type StatBadgeProps } from "./components/stat-badge";
export { SealMotif, type SealMotifProps } from "./components/seal-motif";
export {
  CustodyTimeline,
  type CustodyTimelineProps,
  type CustodyTimelineItem,
  type CustodyItemState,
} from "./components/custody-timeline";

/* Forms */
export {
  PhoneInput,
  formatE164ForDisplay,
  formatUsPhone,
  normalizeUsPhone,
  toE164,
  type PhoneInputProps,
} from "./components/phone-input";
export { OTPInput, type OTPInputProps } from "./components/otp-input";
export { Calendar, type CalendarProps } from "./components/calendar";
export { DateTimeField, type DateTimeFieldProps } from "./components/date-time-field";
export { NumberStepper, type NumberStepperProps } from "./components/number-stepper";
export {
  PriceEstimator,
  type PriceEstimatorProps,
  type PriceEstimatorInput,
  type PriceEstimatorTier,
  type PriceEstimatorAirport,
  type PriceEstimateResult,
  type PriceEstimateLine,
} from "./components/price-estimator";

/* App shell — the standardized in-app frame (see app-shell.tsx) */
export {
  AppHeader,
  ContentColumn,
  AppFooter,
  type AppHeaderProps,
  type AppNavLink,
  type ContentColumnProps,
  type AppFooterProps,
} from "./components/app-shell";
export { PageHeader, type PageHeaderProps } from "./components/page-header";
export { BackLink, type BackLinkProps } from "./components/back-link";
export {
  BookingStatusBadge,
  type BookingStatusBadgeProps,
} from "./components/booking-status-badge";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/confirm-dialog";
export { ImageLightbox, type ImageLightboxProps } from "./components/image-lightbox";

/* Feedback — every async action must show one of these */
export { Spinner, type SpinnerProps } from "./components/spinner";
export { FormMessage, type FormMessageProps } from "./components/form-message";
export { OrDivider, type OrDividerProps } from "./components/or-divider";
export { usePreservedFormValues } from "./lib/use-preserved-form";
export {
  BOOKING_SIGNAL_TABLE,
  SIGNAL_DEBOUNCE_MS,
  SIGNAL_POLL_MS,
  useBookingSignal,
  type BookingSignalClient,
  type BookingSignalStatus,
  type UseBookingSignalOptions,
} from "./lib/booking-signal";
export {
  PasswordResetForm,
  SetPasswordForm,
  StaffLoginForm,
  type StaffAuthState,
} from "./components/staff-auth-forms";
export {
  EmptyState,
  DatabaseNotConfigured,
  type EmptyStateProps,
} from "./components/empty-state";
export { Skeleton, PageSkeleton, type PageSkeletonProps } from "./components/skeleton";
export { EnvStatusCard, type EnvStatusCardProps } from "./components/env-status-card";
export { Select } from "./components/select";
export { Checkbox, CheckboxField, type CheckboxFieldProps } from "./components/checkbox";
export {
  MultiSelect,
  type MultiSelectProps,
  type MultiSelectOption,
} from "./components/multi-select";

/* Data tables */
export { LinkedTableRow, type LinkedTableRowProps } from "./components/linked-table-row";
/* Separate module on purpose — see the note in row-link.tsx. */
export { RowLink, type RowLinkProps } from "./components/row-link";
export {
  RawDataDisclosure,
  type RawDataDisclosureProps,
} from "./components/raw-data-disclosure";

/* Prose */
export { Markdown, type MarkdownProps } from "./components/markdown";
export { RichTextEditor, type RichTextEditorProps } from "./components/rich-text-editor";

/* Motion */
export { Reveal, type RevealProps } from "./components/reveal";
export { HeroRouteScene, type HeroRouteSceneProps } from "./components/hero-route-scene";
