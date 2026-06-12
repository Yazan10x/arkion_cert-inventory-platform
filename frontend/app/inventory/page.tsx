import { revalidatePath } from "next/cache";

type Certificate = {
    id: string;
    common_name: string;
    subject: string;
    issuer: string;
    serial_number: string | null;
    status: string;
    certificate_pem: string | null;
    fingerprint_sha256: string | null;
    not_before: string | null;
    expiration: string;
    san_entries: string[];
    issued_by: string | null;
    owner_service: string | null;
    environment: string | null;
    created_at: string;
    updated_at: string;
};

type Stats = {
    total_certificates: number;
    expiring_soon_30_days: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8081";

async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });

    if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
    }

    return res.json();
}

function validateCommonName(value: string) {
    if (!value) return "Common name is required.";
    if (value.length < 3) return "Common name must be at least 3 characters.";
    if (value.length > 253) return "Common name must be 253 characters or fewer.";

    const pattern =
        /^(localhost|([a-zA-Z0-9-]{2,63}\.)*[a-zA-Z0-9-]{2,63}(\.[a-zA-Z]{2,63})?)$/;

    if (!pattern.test(value)) {
        return "Enter a valid domain or service name, for example api.company.com.";
    }

    return null;
}

function validateOwnerService(value: string) {
    if (!value) return null;
    if (value.length > 80) return "Owner service must be 80 characters or fewer.";

    if (!/^[a-zA-Z0-9-_./ ]+$/.test(value)) {
        return "Only letters, numbers, spaces, dashes, underscores, dots, and slashes are allowed.";
    }

    return null;
}

function validateEnvironment(value: string) {
    if (!value) return "Environment is required.";
    if (value.length > 50) return "Environment must be 50 characters or fewer.";

    if (!/^[a-zA-Z0-9-_./ ]+$/.test(value)) {
        return "Only letters, numbers, spaces, dashes, underscores, dots, and slashes are allowed.";
    }

    return null;
}

function validateValidityDays(value: number) {
    if (!Number.isInteger(value)) return "Validity must be a whole number.";
    if (value < 1) return "Validity must be at least 1 day.";
    if (value > 825) return "Validity must be 825 days or fewer.";

    return null;
}

async function issueCertificate(formData: FormData) {
    "use server";

    const commonName = String(formData.get("common_name") ?? "").trim();
    const ownerService = String(formData.get("owner_service") ?? "").trim();

    const environmentChoice = String(formData.get("environment_choice") ?? "").trim();
    const environmentOther = String(formData.get("environment_other") ?? "").trim();

    const validityChoice = String(formData.get("validity_choice") ?? "").trim();
    const validityCustom = String(formData.get("validity_custom") ?? "").trim();

    const environment =
        environmentChoice === "other" ? environmentOther : environmentChoice;

    const validityDays =
        validityChoice === "custom" ? Number(validityCustom) : Number(validityChoice);

    const commonNameError = validateCommonName(commonName);
    if (commonNameError) return;

    const ownerServiceError = validateOwnerService(ownerService);
    if (ownerServiceError) return;

    const environmentError = validateEnvironment(environment);
    if (environmentError) return;

    const validityError = validateValidityDays(validityDays);
    if (validityError) return;

    const res = await fetch(`${API_BASE_URL}/certificates/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            common_name: commonName,
            san_entries: [commonName],
            owner_service: ownerService || null,
            environment,
            validity_days: validityDays,
        }),
    });

    if (!res.ok) {
        return;
    }

    revalidatePath("/inventory");
}

function formatDate(value: string | null) {
    if (!value) return "N/A";

    return new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "short",
        day: "2-digit",
    }).format(new Date(value));
}

function isExpiringSoon(expiration: string) {
    const expiresAt = new Date(expiration).getTime();
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    return expiresAt >= now && expiresAt <= now + thirtyDays;
}

function getStatusTone(status: string): "success" | "warning" | "neutral" {
    const normalized = status.toLowerCase();

    if (normalized === "active") return "success";
    if (normalized === "expired" || normalized === "revoked") return "warning";

    return "neutral";
}

export default async function InventoryPage() {
    let certificates: Certificate[] = [];
    let stats: Stats = {
        total_certificates: 0,
        expiring_soon_30_days: 0,
    };
    let error: string | null = null;

    try {
        [certificates, stats] = await Promise.all([
            fetchJson<Certificate[]>("/certificates"),
            fetchJson<Stats>("/certificates/stats"),
        ]);
    } catch (err) {
        error = err instanceof Error ? err.message : "Failed to load inventory.";
    }

    const activeServices = new Set(
        certificates.map((c) => c.owner_service).filter(Boolean),
    ).size;

    return (
        <main className="min-h-screen bg-[#f4f5f7] px-4 py-6 text-[#172b4d] sm:px-6 lg:px-10">
            <div className="mx-auto max-w-7xl">
                <header className="mb-6 overflow-hidden rounded-2xl border border-[#dfe1e6] bg-white shadow-sm">
                    <div className="bg-gradient-to-r from-[#0747a6] via-[#0052cc] to-[#2684ff] px-6 py-8 text-white">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-100">
                                    Certificate Inventory
                                </p>
                                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                                    Security Certificates
                                </h1>
                                <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50">
                                    Monitor issued certificates, expiration risk, ownership, and environment metadata from one clean dashboard.
                                </p>
                            </div>

                            <div className="rounded-xl bg-white/15 px-4 py-3 text-sm shadow-sm ring-1 ring-white/25 backdrop-blur">
                                <p className="font-medium text-blue-50">Connected API</p>
                                <p className="mt-1 font-mono text-xs text-white">
                                    {API_BASE_URL}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid divide-y divide-[#dfe1e6] bg-white md:grid-cols-3 md:divide-x md:divide-y-0">
                        <MetricCard
                            label="Total certificates"
                            value={stats.total_certificates}
                            helper="All certificates in inventory"
                        />
                        <MetricCard
                            label="Expiring in 30 days"
                            value={stats.expiring_soon_30_days}
                            helper="Requires rotation planning"
                            tone={stats.expiring_soon_30_days > 0 ? "warning" : "default"}
                        />
                        <MetricCard
                            label="Active services"
                            value={activeServices}
                            helper="Unique service owners"
                        />
                    </div>
                </header>

                {error && (
                    <section className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm">
                        <h2 className="font-semibold">Could not load inventory</h2>
                        <p className="mt-1 text-sm">{error}</p>
                    </section>
                )}

                <section className="mb-6 overflow-hidden rounded-2xl border border-[#dfe1e6] bg-white shadow-sm">
                    <div className="border-b border-[#dfe1e6] px-6 py-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold">Issue certificate</h2>
                                <p className="mt-1 text-sm leading-6 text-[#5e6c84]">
                                    Generate a demo self-signed X.509 certificate and store its metadata.
                                </p>
                            </div>
                        </div>
                    </div>

                    <form
                        id="issue-certificate-form"
                        action={issueCertificate}
                        noValidate
                        className="grid gap-5 px-6 py-6"
                    >
                        <div id="form-error-banner" className="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                            Please fix the highlighted fields before issuing a certificate.
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <FieldShell
                                label="Common name"
                                name="common_name"
                                required
                                helper="Use a DNS name or internal service name."
                            >
                                <input
                                    id="common_name"
                                    name="common_name"
                                    placeholder="api.company.com"
                                    data-field="common_name"
                                    className={fieldClassName}
                                />
                            </FieldShell>

                            <FieldShell
                                label="Owner service"
                                name="owner_service"
                                helper="Optional. Team, service, or workload that owns this certificate."
                            >
                                <input
                                    id="owner_service"
                                    name="owner_service"
                                    placeholder="payments-api"
                                    data-field="owner_service"
                                    className={fieldClassName}
                                />
                            </FieldShell>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <FieldShell
                                label="Environment"
                                name="environment_choice"
                                required
                                helper="Choose an environment, or select Other to type your own."
                            >
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <select
                                        id="environment_choice"
                                        name="environment_choice"
                                        defaultValue="staging"
                                        data-field="environment"
                                        className={fieldClassName}
                                    >
                                        <option value="development">Development</option>
                                        <option value="staging">Staging</option>
                                        <option value="production">Production</option>
                                        <option value="qa">QA</option>
                                        <option value="sandbox">Sandbox</option>
                                        <option value="other">Other</option>
                                    </select>

                                    <input
                                        id="environment_other"
                                        name="environment_other"
                                        placeholder="Enter environment"
                                        data-field="environment"
                                        disabled
                                        className={`${fieldClassName} disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#97a0af]`}
                                    />
                                </div>
                            </FieldShell>

                            <FieldShell
                                label="Validity"
                                name="validity_choice"
                                required
                                helper="Choose a preset, or select Custom to enter days manually."
                            >
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <select
                                        id="validity_choice"
                                        name="validity_choice"
                                        defaultValue="365"
                                        data-field="validity_days"
                                        className={fieldClassName}
                                    >
                                        <option value="1">1 day</option>
                                        <option value="7">1 week</option>
                                        <option value="30">1 month</option>
                                        <option value="180">6 months</option>
                                        <option value="365">1 year</option>
                                        <option value="custom">Custom</option>
                                    </select>

                                    <input
                                        id="validity_custom"
                                        name="validity_custom"
                                        placeholder="Enter days"
                                        inputMode="numeric"
                                        data-field="validity_days"
                                        disabled
                                        className={`${fieldClassName} disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#97a0af]`}
                                    />
                                </div>
                            </FieldShell>
                        </div>

                        <div className="flex flex-col gap-3 border-t border-[#dfe1e6] pt-5 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-[#5e6c84]">
                                Required fields are marked with{" "}
                                <span className="font-semibold text-red-500">*</span>. Errors appear as you type.
                            </p>

                            <button
                                type="submit"
                                className="inline-flex items-center justify-center rounded-lg bg-[#0052cc] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0747a6] focus:outline-none focus:ring-2 focus:ring-[#0052cc]/30 active:translate-y-px"
                            >
                                Issue certificate
                            </button>
                        </div>
                    </form>
                </section>

                <section className="overflow-hidden rounded-2xl border border-[#dfe1e6] bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-[#dfe1e6] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-lg font-semibold">Inventory</h2>
                            <p className="mt-1 text-sm text-[#5e6c84]">
                                Expand a certificate to inspect metadata, SANs, fingerprint, and PEM.
                            </p>
                        </div>

                        <div className="rounded-full bg-[#f4f5f7] px-3 py-1 text-xs font-medium text-[#5e6c84] ring-1 ring-[#dfe1e6]">
                            {certificates.length} records
                        </div>
                    </div>

                    <div className="divide-y divide-[#dfe1e6]">
                        {certificates.length === 0 ? (
                            <div className="px-6 py-14 text-center">
                                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f4f5f7] text-xl">
                                    🔐
                                </div>
                                <h3 className="mt-4 font-semibold">No certificates found</h3>
                                <p className="mt-1 text-sm text-[#5e6c84]">
                                    Issue your first certificate to populate the inventory.
                                </p>
                            </div>
                        ) : (
                            certificates.map((cert) => (
                                <details key={cert.id} className="group">
                                    <summary className="cursor-pointer list-none px-6 py-4 transition hover:bg-[#f7f8fa]">
                                        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_auto] lg:items-center">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="font-semibold text-[#172b4d]">
                                                        {cert.common_name}
                                                    </h3>

                                                    <Badge tone={getStatusTone(cert.status)}>
                                                        {cert.status}
                                                    </Badge>

                                                    {isExpiringSoon(cert.expiration) && (
                                                        <Badge tone="warning">Expiring soon</Badge>
                                                    )}
                                                </div>

                                                <p className="mt-1 line-clamp-1 text-sm text-[#5e6c84]">
                                                    {cert.subject}
                                                </p>
                                            </div>

                                            <RowField
                                                label="Owner"
                                                value={cert.owner_service ?? "Unassigned"}
                                            />
                                            <RowField
                                                label="Environment"
                                                value={cert.environment ?? "N/A"}
                                            />
                                            <RowField
                                                label="Expires"
                                                value={formatDate(cert.expiration)}
                                            />

                                            <span className="inline-flex items-center justify-end text-sm font-semibold text-[#0052cc]">
                                                Details
                                                <span className="ml-1 transition group-open:rotate-90">
                                                    →
                                                </span>
                                            </span>
                                        </div>
                                    </summary>

                                    <div className="border-t border-[#dfe1e6] bg-[#fafbfc] px-6 py-5">
                                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                            <Info label="ID" value={cert.id} />
                                            <Info label="Issuer" value={cert.issuer} />
                                            <Info label="Environment" value={cert.environment ?? "N/A"} />
                                            <Info label="Serial Number" value={cert.serial_number ?? "N/A"} />
                                            <Info label="Fingerprint SHA-256" value={cert.fingerprint_sha256 ?? "N/A"} />
                                            <Info label="Issued By" value={cert.issued_by ?? "N/A"} />
                                            <Info label="Not Before" value={formatDate(cert.not_before)} />
                                            <Info label="Created" value={formatDate(cert.created_at)} />
                                            <Info label="Updated" value={formatDate(cert.updated_at)} />
                                        </div>

                                        <div className="mt-5">
                                            <p className="mb-2 text-sm font-semibold text-[#5e6c84]">
                                                SAN entries
                                            </p>

                                            {cert.san_entries.length === 0 ? (
                                                <p className="text-sm text-[#5e6c84]">
                                                    No SAN entries.
                                                </p>
                                            ) : (
                                                <div className="flex flex-wrap gap-2">
                                                    {cert.san_entries.map((san) => (
                                                        <span
                                                            key={san}
                                                            className="rounded-md bg-[#ebecf0] px-2.5 py-1 text-xs font-semibold text-[#172b4d]"
                                                        >
                                                            {san}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {cert.certificate_pem && (
                                            <div className="mt-5">
                                                <p className="mb-2 text-sm font-semibold text-[#5e6c84]">
                                                    Certificate PEM
                                                </p>
                                                <pre className="max-h-72 overflow-auto rounded-xl bg-[#091e42] p-4 text-xs leading-5 text-white shadow-inner">
                                                    {cert.certificate_pem}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </details>
                            ))
                        )}
                    </div>
                </section>
            </div>

            <script
                dangerouslySetInnerHTML={{
                    __html: `
(function () {
    const form = document.getElementById("issue-certificate-form");
    if (!form) return;

    const banner = document.getElementById("form-error-banner");

    const commonName = document.getElementById("common_name");
    const ownerService = document.getElementById("owner_service");

    const environmentChoice = document.getElementById("environment_choice");
    const environmentOther = document.getElementById("environment_other");

    const validityChoice = document.getElementById("validity_choice");
    const validityCustom = document.getElementById("validity_custom");

    const touched = {};

    function getEnvironment() {
        return environmentChoice.value === "other"
            ? environmentOther.value.trim()
            : environmentChoice.value.trim();
    }

    function getValidityDays() {
        return validityChoice.value === "custom"
            ? validityCustom.value.trim()
            : validityChoice.value.trim();
    }

    function setError(fieldName, message) {
        const messageEl = document.querySelector('[data-error-for="' + fieldName + '"]');
        const fieldShell = document.querySelector('[data-shell-for="' + fieldName + '"]');
        const inputs = document.querySelectorAll('[data-field="' + fieldName + '"]');

        if (messageEl) {
            messageEl.textContent = message || "";
            messageEl.classList.toggle("hidden", !message);
        }

        if (fieldShell) {
            fieldShell.classList.toggle("has-error", Boolean(message));
        }

        inputs.forEach((input) => {
            input.classList.toggle("border-red-400", Boolean(message));
            input.classList.toggle("ring-2", Boolean(message));
            input.classList.toggle("ring-red-100", Boolean(message));
            input.classList.toggle("focus:border-red-500", Boolean(message));

            input.classList.toggle("border-[#c1c7d0]", !message);
            input.setAttribute("aria-invalid", message ? "true" : "false");
        });
    }

    function validateCommonName(value) {
        const trimmed = value.trim();

        if (!trimmed) return "Common name is required.";
        if (trimmed.length < 3) return "Common name must be at least 3 characters.";
        if (trimmed.length > 253) return "Common name must be 253 characters or fewer.";

        const pattern = /^(localhost|([a-zA-Z0-9-]{2,63}\\.)*[a-zA-Z0-9-]{2,63}(\\.[a-zA-Z]{2,63})?)$/;

        if (!pattern.test(trimmed)) {
            return "Enter a valid domain or service name.";
        }

        return "";
    }

    function validateOwnerService(value) {
        const trimmed = value.trim();

        if (!trimmed) return "";
        if (trimmed.length > 80) return "Owner service must be 80 characters or fewer.";

        if (!/^[a-zA-Z0-9-_./ ]+$/.test(trimmed)) {
            return "Only letters, numbers, spaces, dashes, underscores, dots, and slashes are allowed.";
        }

        return "";
    }

    function validateEnvironment(value) {
        const trimmed = value.trim();

        if (!trimmed) return "Environment is required.";
        if (trimmed.length > 50) return "Environment must be 50 characters or fewer.";

        if (!/^[a-zA-Z0-9-_./ ]+$/.test(trimmed)) {
            return "Only letters, numbers, spaces, dashes, underscores, dots, and slashes are allowed.";
        }

        return "";
    }

    function validateValidityDays(value) {
        const trimmed = value.trim();
        const days = Number(trimmed);

        if (!trimmed) return "Validity is required.";
        if (!Number.isInteger(days)) return "Validity must be a whole number.";
        if (days < 1) return "Validity must be at least 1 day.";
        if (days > 825) return "Validity must be 825 days or fewer.";

        return "";
    }

    function validateField(fieldName, forceShow) {
        let error = "";

        if (fieldName === "common_name") {
            error = validateCommonName(commonName.value);
        }

        if (fieldName === "owner_service") {
            error = validateOwnerService(ownerService.value);
        }

        if (fieldName === "environment") {
            error = validateEnvironment(getEnvironment());
        }

        if (fieldName === "validity_days") {
            error = validateValidityDays(getValidityDays());
        }

        if (forceShow || touched[fieldName]) {
            setError(fieldName, error);
        }

        return error;
    }

    function validateAll(forceShow) {
        const errors = [
            validateField("common_name", forceShow),
            validateField("owner_service", forceShow),
            validateField("environment", forceShow),
            validateField("validity_days", forceShow),
        ];

        const hasErrors = errors.some(Boolean);

        if (banner) {
            banner.classList.toggle("hidden", !hasErrors);
        }

        return !hasErrors;
    }

    function touchAndValidate(fieldName) {
        touched[fieldName] = true;
        validateField(fieldName, true);
        validateAll(false);
    }

    function syncConditionalFields() {
        const isOtherEnvironment = environmentChoice.value === "other";
        environmentOther.disabled = !isOtherEnvironment;

        if (!isOtherEnvironment) {
            environmentOther.value = "";
        }

        const isCustomValidity = validityChoice.value === "custom";
        validityCustom.disabled = !isCustomValidity;

        if (!isCustomValidity) {
            validityCustom.value = "";
        }
    }

    commonName.addEventListener("input", function () {
        touchAndValidate("common_name");
    });

    commonName.addEventListener("blur", function () {
        touchAndValidate("common_name");
    });

    ownerService.addEventListener("input", function () {
        touchAndValidate("owner_service");
    });

    ownerService.addEventListener("blur", function () {
        touchAndValidate("owner_service");
    });

    environmentChoice.addEventListener("change", function () {
        syncConditionalFields();
        touchAndValidate("environment");
    });

    environmentOther.addEventListener("input", function () {
        touchAndValidate("environment");
    });

    environmentOther.addEventListener("blur", function () {
        touchAndValidate("environment");
    });

    validityChoice.addEventListener("change", function () {
        syncConditionalFields();
        touchAndValidate("validity_days");
    });

    validityCustom.addEventListener("input", function () {
        touchAndValidate("validity_days");
    });

    validityCustom.addEventListener("blur", function () {
        touchAndValidate("validity_days");
    });

    form.addEventListener("submit", function (event) {
        touched.common_name = true;
        touched.owner_service = true;
        touched.environment = true;
        touched.validity_days = true;

        const isValid = validateAll(true);

        if (!isValid) {
            event.preventDefault();
        }
    });

    syncConditionalFields();
})();
                    `,
                }}
            />
        </main>
    );
}

const fieldClassName =
    "mt-1.5 w-full rounded-lg border border-[#c1c7d0] bg-white px-3 py-2.5 text-sm text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#97a0af] focus:border-[#0052cc] focus:ring-2 focus:ring-[#0052cc]/15";

function FieldShell({
                        label,
                        name,
                        required = false,
                        helper,
                        children,
                    }: {
    label: string;
    name: string;
    required?: boolean;
    helper: string;
    children: React.ReactNode;
}) {
    return (
        <div data-shell-for={name}>
            <label className="block">
                <span className="text-sm font-semibold text-[#172b4d]">
                    {label}
                    {required && <span className="ml-1 text-red-500">*</span>}
                </span>

                {children}
            </label>

            <p data-error-for={name} className="mt-1.5 hidden text-xs font-medium text-red-600" />

            <p className="mt-1.5 text-xs text-[#6b778c]">{helper}</p>
        </div>
    );
}

function MetricCard({
                        label,
                        value,
                        helper,
                        tone = "default",
                    }: {
    label: string;
    value: number;
    helper: string;
    tone?: "default" | "warning";
}) {
    return (
        <div className="p-5">
            <p className="text-sm font-medium text-[#5e6c84]">{label}</p>
            <p
                className={`mt-2 text-3xl font-semibold ${
                    tone === "warning" ? "text-[#974f0c]" : "text-[#172b4d]"
                }`}
            >
                {value}
            </p>
            <p className="mt-1 text-xs text-[#5e6c84]">{helper}</p>
        </div>
    );
}

function RowField({ label, value }: { label: string; value: string }) {
    return (
        <div className="text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-[#6b778c]">
                {label}
            </p>
            <p className="mt-1 font-semibold text-[#172b4d]">{value}</p>
        </div>
    );
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-[#dfe1e6] bg-white p-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6b778c]">
                {label}
            </p>
            <p className="mt-1 break-words text-sm font-medium text-[#172b4d]">
                {value}
            </p>
        </div>
    );
}

function Badge({
                   children,
                   tone = "success",
               }: {
    children: React.ReactNode;
    tone?: "success" | "warning" | "neutral";
}) {
    const className =
        tone === "warning"
            ? "bg-[#fff0b3] text-[#7a5d00] ring-[#ffe380]"
            : tone === "neutral"
                ? "bg-[#ebecf0] text-[#42526e] ring-[#dfe1e6]"
                : "bg-[#e3fcef] text-[#006644] ring-[#abf5d1]";

    return (
        <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ${className}`}
        >
            {children}
        </span>
    );
}