<script lang="ts">
  import { logger } from '../../../utils/logger';

  /**
   * 增强的激活表单组件
   * 统一的激活码输入和验证界面
   */
  
  import {
    ACTIVATION_CODE_FORMAT,
    ACTIVATION_CODE_UI,
    cleanActivationCodeInput,
    isActivationCodeLengthValid,
    isActivationCodeFormatValid
  } from '../constants/activation-constants';
  
  import { sanitizeCloudLicenseUserMessage } from '../../../utils/activation-privacy';
  import { licenseManager, ActivationAttemptLimiter } from '../../../utils/licenseManager';
  import { PremiumFeatureGuard } from '../../../services/premium/PremiumFeatureGuard';
  import {
    getPluginEffectiveLicenseState,
    getPluginLicensedProduct,
    removePluginActivation,
    upsertPluginLocalLicense
  } from '../../../utils/plugin-license';
  import { emitWeaveLicenseChanged } from '../../../utils/license-sync-bridge';
  import { copyTextToClipboard, focusElementById } from '../../../utils/clipboard-copy';

  import type { EffectiveLicenseState } from '../../../types/license';
  import type StandaloneEpubPlugin from '../../../main';
  import { createSafeNotice } from '../../../utils/obsidian-api-safe';
  import Icon from '../../ui/Icon.svelte';
  import { showNotification } from '../../../utils/notifications';
  import { showObsidianConfirm } from '../../../utils/obsidian-confirm';
  import { tr } from '../../../utils/i18n';
  import {
    formatLicenseDeviceStats,
    resolveLicenseDeviceStats,
  } from '../../../utils/license-device-stats';

  // ==================== Props ====================
  
  interface Props {
    plugin: StandaloneEpubPlugin;
    onSave: () => Promise<void>;
    onActivationSuccess?: (licenseInfo: any) => void;
    onActivationError?: (error: any) => void;
    standalone?: boolean; // 是否独立显示（显示容器装饰），默认true
    showHeader?: boolean;
    displayState?: EffectiveLicenseState | null;
  }

  let { 
    plugin, 
    onSave, 
    onActivationSuccess, 
    onActivationError,
    standalone = true,
    showHeader = true,
    displayState = null
  }: Props = $props();
  let t = $derived($tr);

  // ==================== State Management ====================
  
  let activationCode = $state('');
  let email = $state('');
  let emailConfirm = $state('');
  let isActivating = $state(false);
  let validationState = $state<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  let emailValidationState = $state<'idle' | 'valid' | 'invalid'>('idle');
  let activationError = $state<string | null>(null);
  let activationSuccess = $state(false);
  let showHelp = $state(false);
  let remainingAttempts = $state<number | null>(null);
  let showActivationCodeFull = $state(false);
  const supportEmail = 'tutaoyuan8@outlook.com';
  const supportSubject = 'Zora Reader activation support';

  // ==================== Derived State ====================
  
  let cleanedCode = $derived(cleanActivationCodeInput(activationCode));

  let isValidLength = $derived(cleanedCode ? isActivationCodeLengthValid(cleanedCode) : false);

  let isValidFormat = $derived(cleanedCode ? isActivationCodeFormatValid(cleanedCode) : false);

  let isEmailValid = $derived.by(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  });

  let isEmailMatching = $derived(email && emailConfirm && email.toLowerCase().trim() === emailConfirm.toLowerCase().trim());

  let canActivate = $derived(isValidLength && isValidFormat && isEmailValid && isEmailMatching && !isActivating);

  let characterCount = $derived(cleanedCode.length);

  let isInOptimalRange = $derived.by(() => {
    const [min, max] = ACTIVATION_CODE_FORMAT.OPTIMAL_LENGTH_RANGE;
    return characterCount >= min && characterCount <= max;
  });

  // ==================== License Status ====================

  let effectiveLicenseState = $derived.by(() => displayState ?? getPluginEffectiveLicenseState(plugin));

  let currentLicenseInfo = $derived(effectiveLicenseState.primaryLicense || plugin.settings?.license || null);

  let deviceStats = $derived(resolveLicenseDeviceStats(currentLicenseInfo, plugin?.app));

  let isLicenseActive = $derived(effectiveLicenseState.isPremiumActive);
  let helpInputTips = $derived.by(() => [
    t('epub.settings.license.activation.help.inputTip1'),
    t('epub.settings.license.activation.help.inputTip2'),
    t('epub.settings.license.activation.help.inputTip3'),
    t('epub.settings.license.activation.help.inputTip4'),
  ]);

  let helpTroubleshootingTips = $derived.by(() => [
    t('epub.settings.license.activation.help.troubleshootingTip1'),
    t('epub.settings.license.activation.help.troubleshootingTip2'),
    t('epub.settings.license.activation.help.troubleshootingTip3'),
    t('epub.settings.license.activation.help.troubleshootingTip4'),
  ]);

  // ==================== Event Handlers ====================
  
  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    activationCode = target.value;
    
    // 清除之前的错误状态
    if (activationError) {
      activationError = null;
    }
    
    // 实时验证
    if (ACTIVATION_CODE_UI.FEEDBACK.SHOW_REAL_TIME) {
      validateInput();
    }
  }

  function handlePaste(event: ClipboardEvent) {
    // 允许粘贴，然后清理格式
    window.setTimeout(() => {
      activationCode = cleanActivationCodeInput(activationCode);
      validateInput();
    }, 0);
  }

  function validateInput() {
    if (!cleanedCode) {
      validationState = 'idle';
      return;
    }

    validationState = 'validating';
    
    // 模拟验证延迟
    window.setTimeout(() => {
      if (isValidLength && isValidFormat) {
        validationState = 'valid';
      } else {
        validationState = 'invalid';
      }
    }, ACTIVATION_CODE_UI.FEEDBACK.DEBOUNCE_MS);
  }

  // ==================== Activation Logic ====================
  
  async function handleActivation() {
    if (!canActivate) return;

    // 检查激活尝试限制
    const attemptCheck = await ActivationAttemptLimiter.canAttemptActivation();
    if (!attemptCheck.canAttempt) {
      activationError = sanitizeCloudLicenseUserMessage(
        attemptCheck.error || t('epub.settings.license.activation.errors.attemptLimitExceeded')
      );
      validationState = 'invalid';
      return;
    }

    isActivating = true;
    activationError = null;
    activationSuccess = false;

    try {
      const result = await licenseManager.activateLicense(cleanedCode, email, {
        targetProduct: getPluginLicensedProduct(plugin)
      });

      // 记录激活尝试
      await ActivationAttemptLimiter.recordAttempt(result.success);

      if (result.success && result.licenseInfo) {
        upsertPluginLocalLicense(plugin, result.licenseInfo);
        await PremiumFeatureGuard.getInstance().updateLicenseState({
          product: getPluginLicensedProduct(plugin),
          localLicenses: getPluginEffectiveLicenseState(plugin).localLicenses,
        });
        await onSave();
        emitWeaveLicenseChanged(plugin.app);
        
        // 显示成功状态
        activationSuccess = true;
        activationCode = '';
        email = '';
        emailConfirm = '';
        validationState = 'idle';
        emailValidationState = 'idle';
        
        // 调用成功回调
        if (onActivationSuccess) {
          onActivationSuccess(result.licenseInfo);
        }
        
        if (result.cloudInfo?.replacedOldDevice) {
          showNotification(t('epub.settings.license.activation.deviceReplaced'), 'info');
        }

        showSuccessNotification();
      } else {
        // 激活失败
        activationError = sanitizeCloudLicenseUserMessage(
          result.error || t('epub.settings.license.activation.errors.failed')
        );
        validationState = 'invalid';
        
        // 调用错误回调
        if (onActivationError) {
          onActivationError(result.error);
        }
        
        // 更新剩余尝试次数
        await updateRemainingAttempts();
      }
    } catch (error) {
      // 未预期的错误
      activationError = sanitizeCloudLicenseUserMessage(
        error instanceof Error ? error.message : t('epub.settings.license.activation.errors.unknown')
      );
      validationState = 'invalid';
      
      // 记录失败
      await ActivationAttemptLimiter.recordAttempt(false);
    } finally {
      isActivating = false;
    }
  }

  // ==================== Helper Functions ====================
  
  function showSuccessNotification() {
    // 这里可以集成通知系统
    // 成功通知已由调用方处理
  }

  function toggleHelp() {
    showHelp = !showHelp;
  }

  function clearInput() {
    activationCode = '';
    email = '';
    emailConfirm = '';
    validationState = 'idle';
    emailValidationState = 'idle';
    activationError = null;
  }

  function validateEmail() {
    if (!email) {
      emailValidationState = 'idle';
      return;
    }
    emailValidationState = isEmailValid ? 'valid' : 'invalid';
  }

  async function updateRemainingAttempts() {
    try {
      const attemptCheck = await ActivationAttemptLimiter.canAttemptActivation();
      // 根据限制器的逻辑计算剩余次数
      remainingAttempts = attemptCheck.canAttempt ? 5 : 0;
    } catch (error) {
      logger.warn('Failed to get remaining activation attempts:', error);
      remainingAttempts = null;
    }
  }

  // 复制激活码到剪贴板
  async function handleCopyActivationCode() {
    if (!currentLicenseInfo?.activationCode) return;
    
    const copied = await copyTextToClipboard(currentLicenseInfo.activationCode);
    if (copied) {
      createSafeNotice(t('epub.settings.license.activation.codeCopied'), 2600);
    } else {
      createSafeNotice(t('epub.settings.license.activation.codeCopyFailed'), 3000);
    }
  }

  // 格式化激活码显示
  function formatActivationCodeDisplay(code: string, showFull: boolean = false): string {
    if (!code) return '';

    if (showFull) {
      // 每64个字符换行，便于阅读
      return code.match(/.{1,64}/g)?.join('\n') || code;
    } else {
      // 显示前20个字符，后面用省略号
      return code.length > 20 ? `${code.substring(0, 20)}...` : code;
    }
  }

  // ==================== Deactivation Logic ====================
  
  async function handleDeactivation() {
    const confirmed = await showObsidianConfirm(
      plugin.app,
      t('epub.settings.license.activation.confirmRemove'),
      { title: t('epub.settings.license.activation.confirmRemoveTitle') }
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = removePluginActivation(plugin);
      
      if (result.removalKind !== 'none') {
        await onSave();
        
        // 显示成功消息
        showNotification(t('epub.settings.license.activation.removed'), 'success');
        
        window.setTimeout(() => {
          if (!focusElementById('activation-code')) {
            activeDocument.body.focus();
            activeDocument.body.blur();
          }
        }, 100);
      } else {
        showNotification(t('epub.settings.license.activation.noActivationToRemove'), 'info');
      }
    } catch (error) {
      logger.error('Failed to remove activation state:', error);
      showNotification(t('epub.settings.license.activation.removeError'), 'error');
    }
  }

  // ==================== Lifecycle ====================
  
  // 组件挂载时更新尝试次数
  $effect(() => {
    updateRemainingAttempts();
  });
</script>

<!-- 激活表单容器 -->
<div class="enhanced-activation-form" class:standalone>
  <!-- 表单标题 -->
  {#if showHeader}
    <div class="form-header">
      <h3 class="form-title">
        {t('epub.settings.license.activation.title')}
      </h3>
      <p class="form-description">
        {t('epub.settings.license.activation.description')}
      </p>
    </div>
  {/if}

  {#if isLicenseActive}
    <!-- 已激活状态 -->
    <div class="activation-success-state">
      <div class="success-content">
        <h4 class="success-title">{t('epub.settings.license.activation.activatedTitle')}</h4>
        {#if currentLicenseInfo}
          <p class="success-details">
            {t('epub.settings.license.activation.activatedAt')}: {new Date(currentLicenseInfo.activatedAt).toLocaleString()}
          </p>
          <p class="success-details">
            {t('epub.settings.license.activation.licenseType')}: {currentLicenseInfo.licenseType === 'lifetime'
              ? t('epub.settings.license.activation.licenseTypeLifetime')
              : t('epub.settings.license.activation.licenseTypeSubscription')}
          </p>
          {#if currentLicenseInfo.boundEmail}
            <p class="success-details">
              {t('epub.settings.license.activation.boundEmail')}: {currentLicenseInfo.boundEmail}
            </p>
          {/if}
          {#if deviceStats}
            <p class="success-details">
              {t('epub.settings.license.activation.activatedDevices', {
                used: deviceStats.used,
                max: deviceStats.max,
              })}
            </p>
          {/if}
          
          <!-- 激活码查看和复制区域 -->
          {#if currentLicenseInfo.activationCode}
            <div class="activation-code-section">
              <div class="activation-code-header">
                <span class="code-label">{t('epub.settings.license.activation.codeLabel')}</span>
                <div class="code-actions">
                  <button
                    class="action-button"
                    onclick={() => showActivationCodeFull = !showActivationCodeFull}
                    title={showActivationCodeFull
                      ? t('epub.settings.license.activation.hideCode')
                      : t('epub.settings.license.activation.showCode')}
                  >
                    <Icon name={showActivationCodeFull ? 'file' : 'eye'} size={14} ariaHidden={true} />
                  </button>
                  <button
                    class="action-button"
                    onclick={handleCopyActivationCode}
                    title={t('epub.settings.license.activation.copyCode')}
                  >
                    <Icon name="copy" size={14} ariaHidden={true} />
                  </button>
                </div>
              </div>
              
              <div class="activation-code-display">
                <code class="activation-code-text" class:full={showActivationCodeFull}>
                  {formatActivationCodeDisplay(currentLicenseInfo.activationCode, showActivationCodeFull)}
                </code>
              </div>
            </div>
          {/if}
          
          <!-- 移除激活按钮 -->
          <div class="deactivation-section">
            <button 
              class="deactivate-button"
              onclick={handleDeactivation}
            >
              {t('epub.settings.license.activation.removeActivation')}
            </button>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- 激活表单 -->
    <div class="activation-form-body">
      <!-- 激活码输入区域 -->
      <div class="activation-field-section">
        <label for="activation-code" class="activation-field-label">{t('epub.settings.license.activation.codeLabel')}</label>
        
        <div class="activation-code-input-container" 
             class:valid={validationState === 'valid'} 
             class:invalid={validationState === 'invalid'}
             class:validating={validationState === 'validating'}>
          
          <textarea
            id="activation-code"
            class="activation-textarea"
            placeholder={t('epub.settings.license.activation.inputPlaceholder')}
            rows={ACTIVATION_CODE_UI.INPUT.TEXTAREA_ROWS}
            maxlength={ACTIVATION_CODE_UI.INPUT.MAX_LENGTH_ATTR}
            bind:value={activationCode}
            oninput={handleInput}
            onpaste={handlePaste}
            disabled={isActivating}
          ></textarea>
          
          <!-- 验证状态指示器 -->
          <div class="validation-indicator">
            {#if validationState === 'validating'}
              <span class="indicator validating">{t('epub.settings.license.activation.validating')}</span>
            {:else if validationState === 'valid'}
              <span class="indicator valid">{t('epub.settings.license.activation.formatValid')}</span>
            {:else if validationState === 'invalid'}
              <span class="indicator invalid">{t('epub.settings.license.activation.formatInvalid')}</span>
            {/if}
          </div>
          
          <!-- 清除按钮 -->
          {#if activationCode}
            <button 
              class="activation-clear-button" 
              onclick={clearInput}
              disabled={isActivating}
              title={t('epub.settings.license.activation.clearInput')}
            >
              {t('epub.settings.license.activation.clear')}
            </button>
          {/if}
        </div>
        
      </div>
      
      <!-- 邮箱输入区域 -->
      <div class="activation-field-section activation-field-section--inline">
        <label for="email" class="activation-field-label activation-field-label--inline">{t('epub.settings.license.activation.email')}</label>
        
        <div class="activation-inline-control">
          <input
            id="email"
            type="email"
            class="activation-email-input"
            class:valid={emailValidationState === 'valid'}
            class:invalid={emailValidationState === 'invalid'}
            placeholder={t('epub.settings.license.activation.emailPlaceholder')}
            bind:value={email}
            oninput={validateEmail}
            disabled={isActivating}
            autocomplete="email"
          />
        </div>
        
      </div>
      
      <!-- 确认邮箱输入区域 -->
      <div class="activation-field-section activation-field-section--inline">
        <label for="email-confirm" class="activation-field-label activation-field-label--inline">{t('epub.settings.license.activation.emailConfirm')}</label>
        
        <div class="activation-inline-control">
          <input
            id="email-confirm"
            type="email"
            class="activation-email-input"
            class:valid={isEmailMatching}
            class:invalid={emailConfirm && !isEmailMatching}
            placeholder={t('epub.settings.license.activation.emailConfirmPlaceholder')}
            bind:value={emailConfirm}
            disabled={isActivating}
            autocomplete="email"
          />
        </div>
        
      </div>

      <!-- 操作按钮区域 -->
      <div class="activation-form-actions">
        <button 
          class="activation-submit-button"
          class:loading={isActivating}
          disabled={!canActivate}
          onclick={handleActivation}
        >
          {#if isActivating}
            <span class="loading-spinner"></span>
            {t('epub.settings.license.activation.submitting')}
          {:else}
            {t('epub.settings.license.activation.submit')}
          {/if}
        </button>
        
        <button 
          class="activation-help-toggle"
          onclick={toggleHelp}
          disabled={isActivating}
        >
          {showHelp ? t('epub.settings.license.activation.hideHelp') : t('epub.settings.license.activation.showHelp')}
        </button>
      </div>
    </div>
  {/if}

  <!-- 帮助信息区域 -->
  {#if showHelp}
    <div class="help-section">
      <div class="help-content">
        <h4>{t('epub.settings.license.activation.help.formatTitle')}</h4>
        <p>{t('epub.settings.license.activation.help.formatDescription')}</p>

        <h4>{t('epub.settings.license.activation.help.inputTipsTitle')}</h4>
        <ul>
          {#each helpInputTips as tip}
            <li>{tip}</li>
          {/each}
        </ul>

        <h4>{t('epub.settings.license.activation.help.troubleshootingTitle')}</h4>
        <ul>
          {#each helpTroubleshootingTips as tip}
            <li>{tip}</li>
          {/each}
        </ul>

        <h4>{t('epub.settings.license.activation.help.contactTitle')}</h4>
        <p>
          {t('epub.settings.license.activation.help.contactIntro')}
          <a href="mailto:{supportEmail}?subject={supportSubject}">
            {supportEmail}
          </a>
        </p>
      </div>
    </div>
  {/if}

  <!-- 错误信息显示 -->
  {#if activationError}
    <div class="error-section">
      <div class="error-header">
        <span class="error-title">{t('epub.settings.license.activation.errorTitle')}</span>
      </div>
      <div class="error-message">{activationError}</div>
      {#if remainingAttempts !== null && remainingAttempts > 0}
        <div class="remaining-attempts">
          {t('epub.settings.license.activation.remainingAttempts', { count: remainingAttempts })}
        </div>
      {/if}
    </div>
  {/if}

  <!-- 成功信息显示 -->
  {#if activationSuccess}
    <div class="success-section">
      <div class="success-header">
        <span class="success-title">{t('epub.settings.license.activation.successTitle')}</span>
      </div>
      <div class="success-message">{t('epub.settings.license.activation.successMessage')}</div>
    </div>
  {/if}
</div>

<!-- ==================== Styles ==================== -->

<style>
  .enhanced-activation-form {
    /* Shared settings spacing + typography tokens */
    --epub-settings-font-size-label: var(--font-ui-small, 0.95rem);
    --epub-settings-font-size-desc: var(--font-ui-smaller, 0.85rem);
    --epub-settings-gap-xs: 0.25rem;
    --epub-settings-gap-sm: 0.35rem;
    --epub-settings-gap-md: 0.5rem;
    --epub-settings-gap-lg: 1rem;
    --epub-settings-gap-xl: 1.5rem;
    --epub-settings-radius-sm: var(--radius-s, 6px);
    --epub-settings-radius-md: var(--radius-m, 8px);
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--epub-settings-gap-lg);
    min-width: 0;
    container-type: inline-size;
    --activation-inline-label-width: clamp(6rem, 10vw, 8rem);
    --activation-inline-control-width: clamp(24rem, 56%, 32rem);
    align-items: stretch;
    text-align: left;
  }

  /* 独立模式样式（有容器装饰） */
  .enhanced-activation-form.standalone {
    max-width: 700px;
    margin: 0 auto var(--epub-settings-gap-xl) auto;
    padding: var(--epub-settings-gap-xl);
    background: var(--background-primary-alt, var(--background-primary));
    border-radius: var(--radius-m, 12px);
    border: 1px solid var(--background-modifier-border);
  }

  /* 表单标题 */
  .form-header {
    display: flex;
    flex-direction: column;
    gap: var(--epub-settings-gap-sm);
  }

  .enhanced-activation-form.standalone .form-header {
    margin-bottom: var(--epub-settings-gap-md);
  }

  .form-title {
    margin: 0 0 var(--epub-settings-gap-md) 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .form-description {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--epub-settings-font-size-desc);
    line-height: 1.55;
  }

  /* 已激活状态 */
  .activation-success-state {
    background: var(--background-primary-alt, var(--background-primary));
    border: 1px solid color-mix(in oklab, var(--background-modifier-border), var(--color-green) 18%);
    border-radius: var(--radius-m, 8px);
    overflow: hidden;
  }

  .success-content {
    padding: var(--epub-settings-gap-lg);
  }

  .success-content h4 {
    margin: 0 0 var(--epub-settings-gap-md) 0;
    color: var(--text-normal);
    font-size: var(--epub-settings-font-size-label);
  }

  .success-details {
    margin: var(--epub-settings-gap-xs) 0;
    color: var(--text-muted);
    font-size: var(--epub-settings-font-size-desc);
    line-height: 1.55;
  }

  /* 激活码查看区域样式 */
  .activation-code-section {
    background: transparent;
    border-radius: var(--radius-s, 8px);
    padding: var(--epub-settings-gap-lg);
    margin-top: var(--epub-settings-gap-lg);
    border: 1px solid var(--background-modifier-border);
  }

  /* 移除激活区域 */
  .deactivation-section {
    margin-top: var(--epub-settings-gap-xl);
    padding-top: var(--epub-settings-gap-lg);
    border-top: 1px solid var(--background-modifier-border);
  }

  .deactivate-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 1.5rem;
    background: var(--background-secondary);
    color: var(--text-error);
    border: 1px solid color-mix(in oklab, var(--color-red), transparent 70%);
    border-radius: var(--button-radius, 6px);
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
  }

  .deactivate-button:hover {
    background: color-mix(in oklab, var(--color-red), transparent 90%);
    border-color: var(--color-red);
  }

  .deactivate-button:active {
    transform: none;
  }

  .activation-code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--epub-settings-gap-md);
  }

  .code-label {
    font-weight: 500;
    color: var(--text-muted);
    font-size: var(--epub-settings-font-size-desc);
  }

  .code-actions {
    display: flex;
    gap: var(--epub-settings-gap-xs);
  }

  .action-button {
    padding: var(--epub-settings-gap-xs) var(--epub-settings-gap-md);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--button-radius, 4px);
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
    font-size: var(--epub-settings-font-size-desc);
  }

  .action-button:hover {
    background: var(--background-modifier-hover);
  }

  .activation-code-display {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 6px);
    padding: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-xs));
  }

  .activation-code-text {
    font-family: var(--font-monospace);
    font-size: 0.75rem;
    color: var(--text-muted);
    word-break: break-all;
    line-height: 1.4;
    display: block;
    margin: 0;
  }

  .activation-code-text.full {
    white-space: pre-wrap;
  }

  /* 激活表单 */
  .activation-form-body {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
    min-width: 0;
    align-items: stretch;
    text-align: left;
  }

  .activation-field-section + .activation-field-section {
    margin-top: var(--epub-settings-gap-lg);
    padding-top: var(--epub-settings-gap-lg);
  }

  /* 输入区域 */
  .activation-field-section {
    display: flex;
    flex-direction: column;
    gap: var(--epub-settings-gap-md);
    min-width: 0;
    width: 100%;
    align-items: stretch;
    text-align: left;
  }

  .activation-field-section--inline {
    display: grid;
    grid-template-columns:
      minmax(var(--activation-inline-label-width), var(--activation-inline-label-width))
      minmax(0, var(--activation-inline-control-width));
    align-items: center;
    justify-content: space-between;
    column-gap: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-sm));
    row-gap: calc(var(--epub-settings-gap-sm) + 0.1rem);
    width: 100%;
  }

  .activation-field-label {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--epub-settings-gap-xs);
    font-weight: 500;
    color: var(--text-normal);
    width: 100%;
    margin: 0;
    text-align: left;
    justify-self: start;
    align-self: start;
  }

  .activation-field-label--inline {
    display: block;
    min-width: 0;
  }

  .activation-inline-control {
    width: min(100%, var(--activation-inline-control-width));
    min-height: 0;
    max-width: 100%;
    min-width: 0;
    justify-self: end;
  }

  .activation-code-input-container {
    position: relative;
    display: flex;
    align-items: stretch;
    min-width: 0;
    width: 100%;
  }

  .activation-textarea {
    flex: 1;
    padding: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-xs));
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--epub-settings-radius-sm);
    background: var(--background-primary);
    color: var(--text-normal);
    font-family: var(--font-monospace);
    font-size: var(--epub-settings-font-size-desc);
    line-height: 1.4;
    resize: vertical;
    min-height: 100px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .activation-textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--interactive-accent), transparent 80%);
  }

  .activation-code-input-container.valid .activation-textarea {
    border-color: var(--color-green);
  }

  .activation-code-input-container.invalid .activation-textarea {
    border-color: var(--color-red);
  }

  .activation-code-input-container.validating .activation-textarea {
    border-color: var(--color-orange);
  }

  .validation-indicator {
    position: absolute;
    right: 0.5rem;
    top: 0.5rem;
    font-size: 1rem;
  }

  .activation-clear-button {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    padding: var(--epub-settings-gap-xs) var(--epub-settings-gap-md);
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-muted);
    border-radius: var(--button-radius, var(--epub-settings-radius-sm));
    cursor: pointer;
    font-size: var(--font-ui-smaller, 0.75rem);
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  .activation-clear-button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  /* 邮箱输入框 */
  .activation-email-input {
    width: 100%;
    padding: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-xs));
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--epub-settings-radius-sm);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: var(--epub-settings-font-size-desc);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .activation-email-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--interactive-accent), transparent 80%);
  }

  .activation-email-input.valid {
    border-color: var(--color-green);
  }

  .activation-email-input.invalid {
    border-color: var(--color-red);
  }

  /* 操作按钮 */
  .activation-form-actions {
    display: flex;
    gap: var(--epub-settings-gap-lg);
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    margin-top: var(--epub-settings-gap-lg);
    padding-top: var(--epub-settings-gap-lg);
    width: 100%;
    text-align: left;
  }

  button.activation-submit-button,
  button.activation-submit-button:hover,
  button.activation-submit-button:active,
  button.activation-submit-button:focus,
  button.activation-submit-button:focus-visible {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--epub-settings-gap-md);
    padding: calc(var(--epub-settings-gap-sm) + 0.1rem) calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-sm));
    background: transparent !important;
    color: var(--text-accent) !important;
    border: none !important;
    border-radius: var(--radius-m, 8px) !important;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
    min-width: 0;
    box-shadow: none !important;
    outline: none !important;
    appearance: none;
  }

  button.activation-submit-button:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  button.activation-submit-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  button.activation-help-toggle,
  button.activation-help-toggle:hover,
  button.activation-help-toggle:active,
  button.activation-help-toggle:focus,
  button.activation-help-toggle:focus-visible {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--epub-settings-gap-sm) + 0.1rem) calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-sm));
    background: transparent !important;
    color: var(--text-muted) !important;
    border: none !important;
    border-radius: var(--radius-m, 8px) !important;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    box-shadow: none !important;
    outline: none !important;
    appearance: none;
  }

  button.activation-help-toggle:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  /* 加载动画 */
  .loading-spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* 帮助区域 */
  .help-section {
    padding: var(--epub-settings-gap-xl);
    background: var(--background-primary-alt, var(--background-secondary));
    border-radius: var(--epub-settings-radius-md);
    border: 1px solid var(--background-modifier-border);
  }

  .help-content h4 {
    margin: var(--epub-settings-gap-lg) 0 var(--epub-settings-gap-md) 0;
    font-size: var(--epub-settings-font-size-label);
    font-weight: 600;
    color: var(--text-normal);
  }

  .help-content h4:first-child {
    margin-top: 0;
  }

  .help-content ul {
    margin: var(--epub-settings-gap-md) 0 var(--epub-settings-gap-lg) 0;
    padding-left: var(--epub-settings-gap-xl);
  }

  .help-content li {
    margin: var(--epub-settings-gap-xs) 0;
    color: var(--text-muted);
    font-size: var(--epub-settings-font-size-desc);
  }

  .help-content p {
    margin: var(--epub-settings-gap-md) 0;
    color: var(--text-muted);
    font-size: var(--epub-settings-font-size-desc);
    line-height: 1.4;
  }

  .help-content a {
    color: var(--text-accent);
    text-decoration: none;
  }

  .help-content a:hover {
    text-decoration: underline;
  }

  @container (max-width: 560px) {
    .activation-field-section--inline {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: calc(var(--epub-settings-gap-sm) + 0.1rem);
    }

    .activation-inline-control {
      width: 100%;
      max-width: 100%;
    }
  }

  @media (max-width: 560px) {
    .activation-field-section--inline {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: calc(var(--epub-settings-gap-sm) + 0.1rem);
    }

    .activation-field-label--inline {
      min-width: 0;
    }

    .activation-inline-control {
      width: 100%;
      max-width: 100%;
    }
  }

  /* 错误区域 */
  .error-section {
    padding: var(--epub-settings-gap-lg);
    background: color-mix(in oklab, var(--background-primary), var(--color-red) 10%);
    border: 1px solid color-mix(in oklab, var(--background-modifier-border), var(--color-red) 20%);
    border-radius: var(--epub-settings-radius-sm);
  }

  .error-header {
    margin-bottom: var(--epub-settings-gap-md);
  }

  .error-title {
    font-weight: 600;
    font-size: var(--epub-settings-font-size-label);
    color: var(--color-red);
  }

  .error-message {
    color: var(--text-normal);
    margin-bottom: var(--epub-settings-gap-md);
    line-height: 1.55;
  }

  .remaining-attempts {
    margin-top: var(--epub-settings-gap-md);
    padding: var(--epub-settings-gap-md);
    background: color-mix(in oklab, var(--background-secondary), var(--color-orange) 12%);
    border-radius: var(--epub-settings-radius-sm);
    color: var(--color-orange);
    font-weight: 500;
    font-size: var(--epub-settings-font-size-desc);
  }

  /* 成功区域 */
  .success-section {
    padding: var(--epub-settings-gap-lg);
    background: color-mix(in oklab, var(--background-primary), var(--color-green) 10%);
    border: 1px solid color-mix(in oklab, var(--background-modifier-border), var(--color-green) 20%);
    border-radius: var(--epub-settings-radius-sm);
  }

  .success-header {
    margin-bottom: var(--epub-settings-gap-md);
  }

  .success-title {
    font-weight: 600;
    font-size: var(--epub-settings-font-size-label);
    color: var(--color-green);
  }

  .success-message {
    color: var(--text-normal);
    margin-bottom: var(--epub-settings-gap-md);
  }

  /* 响应式设计 */
  @media (max-width: 768px) {
    .enhanced-activation-form.standalone {
      margin: 0 0 var(--epub-settings-gap-lg) 0;
      padding: var(--epub-settings-gap-xl);
    }

    .form-title {
      font-size: 1.3rem;
    }

    .activation-textarea {
      font-size: 0.8rem;
    }
  }
</style>
