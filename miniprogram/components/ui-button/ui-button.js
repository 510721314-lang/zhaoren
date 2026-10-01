Component({
  properties: {
    type: { type: String, value: 'primary' },  // primary|ghost|danger|mini
    block: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('tap');
    }
  }
});