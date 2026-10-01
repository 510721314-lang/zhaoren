Component({
  properties: {
    icon: { type: String, value: '' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    cta: { type: String, value: '' }
  },
  methods: {
    onCta() {
      this.triggerEvent('ctap');
    }
  }
});